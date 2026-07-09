import axios from 'axios';
import dotenv from 'dotenv';
import { identifyEntity } from './constants';
dotenv.config();

const API_KEY = process.env.ETHERSCAN_API_KEY;
const BASE_URL = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '137'; // Polygon Mainnet

// Known DeFi protocol addresses on Polygon (non-exhaustive)
const KNOWN_DEFI_PROTOCOLS = new Set([
    '0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff', // QuickSwap Router
    '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506', // SushiSwap Router
    '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 Router
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap V3 Router 02
    '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch Router
    '0xdef171fe48cf0115b1d80b88dc8eab59176fee57', // Paraswap
    '0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf', // Aave V2 LendingPool
    '0x794a61358d6845594f94dc1db02a252b5b4814ad', // Aave V3 Pool
]);

const POLYMARKET_CONTRACTS = new Set([
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // CTF Exchange
    '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Exchange
    '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', // CTF Token (ERC-1155)
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
]);

export interface WalletProfile {
    address: string;
    firstTxTs: number | null;
    totalTxCount: number;
    hasCoverBehavior: boolean;
    fundedBy: string | null;
    fundSourceType: string | null;
    hasNoDeFiInteraction: boolean;
    isPolymarketOnly: boolean;
}

/**
 * Asks Polygonscan API for the transaction history of an address to deduce its age and tx count.
 */
export async function getWalletProfile(address: string): Promise<WalletProfile> {
    if (!API_KEY) {
        console.warn('ETHERSCAN_API_KEY is not set. Cannot fetch wallet profile.');
        return { address, firstTxTs: null, totalTxCount: 0, hasCoverBehavior: false, fundedBy: null, fundSourceType: null, hasNoDeFiInteraction: false, isPolymarketOnly: false };
    }

    try {
        // Fetch up to 1000 transactions to quickly get count. If >= 10, it exceeds the "new wallet" threshold anyway.
        const url = `${BASE_URL}?chainid=${CHAIN_ID}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=1000&sort=asc&apikey=${API_KEY}`;
        
        const response = await axios.get(url);
        if (response.data && response.data.status === '1' && Array.isArray(response.data.result)) {
            const txs = response.data.result;
            const totalTxCount = txs.length; // Might be capped at 1000, which is fine
            let hasCoverBehavior = false;
            let firstTxTs = null;
            let fundedBy = null;
            let fundSourceType = null;
            let hasNoDeFiInteraction = true;
            let isPolymarketOnly = true;

            if (txs.length > 0) {
                // Polygonscan timestamps are in seconds
                firstTxTs = parseInt(txs[0].timeStamp, 10);
                
                // Find first incoming transaction to identify the gas funder
                const firstInTx = txs.find((t: any) => t.to?.toLowerCase() === address.toLowerCase());
                if (firstInTx && firstInTx.from) {
                    fundedBy = firstInTx.from.toLowerCase();
                    const entity = identifyEntity(fundedBy);
                    if (entity) {
                        fundSourceType = entity.type; // 'bridge' | 'swap_service' | 'cex'
                    } else {
                        fundSourceType = 'wallet';
                    }
                }
                
                // Dim A: Zero DeFi interaction check
                // Dim F: Mono-usage Polymarket check
                // Also: Behavioral pollution check
                let nonPolymarketTxs = 0;
                for (const t of txs) {
                    const to = t.to?.toLowerCase();
                    if (!to) continue;
                    
                    // Check if wallet ever interacted with known DeFi
                    if (KNOWN_DEFI_PROTOCOLS.has(to)) {
                        hasNoDeFiInteraction = false;
                    }
                    
                    // Check if wallet ONLY interacts with Polymarket contracts
                    if (!POLYMARKET_CONTRACTS.has(to) && to !== address.toLowerCase()) {
                        isPolymarketOnly = false;
                    }
                }
                
                // Behavioral pollution check (Dimension F)
                if (txs.length > 10) {
                    for (const t of txs.slice(-30)) {
                        const to = t.to?.toLowerCase();
                        if (to && !POLYMARKET_CONTRACTS.has(to)) {
                            nonPolymarketTxs++;
                        }
                    }
                    if (nonPolymarketTxs > 15 && totalTxCount < 100) {
                        hasCoverBehavior = true;
                    }
                }
            }

            return {
                address,
                firstTxTs,
                totalTxCount,
                hasCoverBehavior,
                fundedBy,
                fundSourceType,
                hasNoDeFiInteraction,
                isPolymarketOnly
            };
        }

        // If no transactions found or error
        return { address, firstTxTs: null, totalTxCount: 0, hasCoverBehavior: false, fundedBy: null, fundSourceType: null, hasNoDeFiInteraction: false, isPolymarketOnly: false };

    } catch (error) {
        console.error(`Etherscan API Error for ${address}:`, error);
        return { address, firstTxTs: null, totalTxCount: 0, hasCoverBehavior: false, fundedBy: null, fundSourceType: null, hasNoDeFiInteraction: false, isPolymarketOnly: false };
    }
}

/**
 * Fetches all 'OrderFilled' events for a specific wallet on the CTF Exchange.
 */
export async function getWalletPolymarketHistory(address: string): Promise<any[]> {
    if (!API_KEY) return [];
    
    const CTF_EXCHANGE = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
    const TOPIC_ORDER_FILLED = '0x0000000000000000000000000000000000000000000000000000000000000000'; // Placeholder, actually we need the real topic
    // OrderFilled(bytes32 orderHash, address maker, address taker, bytes32 makerAssetId, bytes32 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)
    // Signature: 0x9335ef008e4ff37e735e58129206b04604e38e55e5714088bc92c906a5b6f0e4
    const SIG_ORDER_FILLED = '0x9335ef008e4ff37e735e58129206b04604e38e55e5714088bc92c906a5b6f0e4';

    try {
        const url = `${BASE_URL}?chainid=${CHAIN_ID}&module=logs&action=getLogs&fromBlock=0&toBlock=99999999&address=${CTF_EXCHANGE}&topic0=${SIG_ORDER_FILLED}&topic1=0x000000000000000000000000${address.substring(2)}&apikey=${API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data?.status === '1' && Array.isArray(response.data.result)) {
            return response.data.result;
        }
    } catch (e) {
        console.error('Error fetching wallet logs:', e);
    }
    return [];
}

/**
 * Fetches the token balance (e.g. USDC) for an address.
 */
export async function getTokenBalance(address: string, tokenAddress: string): Promise<number> {
    if (!API_KEY) return 0;
    try {
        const url = `${BASE_URL}?chainid=${CHAIN_ID}&module=account&action=tokenbalance&contractaddress=${tokenAddress}&address=${address}&tag=latest&apikey=${API_KEY}`;
        const response = await axios.get(url);
        if (response.data && response.data.status === '1') {
            const rawBalance = response.data.result;
            // USDC on Polygon has 6 decimals
            if (tokenAddress.toLowerCase() === '0x2791bca1f2de4661ed88a30c99a7a9449aa84174') {
                return parseInt(rawBalance, 10) / 1e6;
            }
            return parseInt(rawBalance, 10);
        }
        return 0;
    } catch(e) {
        console.error(`Token check error for ${address}:`, e);
        return 0;
    }
}
