import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { processTrade } from './pipeline';

dotenv.config();

const ALCHEMY_WS_URL = process.env.ALCHEMY_API_KEY ? `wss://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}` : null;
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

const CTF_EXCHANGE_ABI = [
    "event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, bytes32 makerAssetId, bytes32 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)"
];

export async function startBlockchainListener() {
    if (!ALCHEMY_WS_URL) {
        console.error("ALCHEMY_API_KEY is missing. Cannot start WebSocket listener.");
        return;
    }

    console.log("Connecting to Alchemy WebSocket...");
    const provider = new ethers.WebSocketProvider(ALCHEMY_WS_URL);
    
    const contract = new ethers.Contract(CTF_EXCHANGE_ADDRESS, CTF_EXCHANGE_ABI, provider);

    console.log("Listening for OrderFilled events on CTF Exchange...");

    contract.on("OrderFilled", async (
        orderHash: string,
        maker: string,
        taker: string,
        makerAssetId: string,
        takerAssetId: string,
        makerAmountFilled: bigint,
        takerAmountFilled: bigint,
        fee: bigint,
        event: any
    ) => {
        // Run the trade through our pipeline
        try {
            // Get block to get timestamp
            const block = await provider.getBlock(event.log.blockNumber);
            const timestamp = block ? block.timestamp : Math.floor(Date.now() / 1000);

            // Construct trade object
            const tradeData = {
                txHash: event.log.transactionHash,
                maker, // wallet placing the bet
                taker,
                makerAssetId, // Condition Token ID (Token ID is usually a uint256 converted to hex, but emitted as bytes32)
                takerAssetId, // USDC is usually taker
                makerAmountFilled, 
                takerAmountFilled, 
                timestamp
            };

            // Call the pipeline asynchronously so we don't block the event loop
            processTrade(tradeData).catch((err: any) => {
                console.error("Error processing trade in pipeline:", err);
            });

        } catch (error) {
            console.error("Error listening to event:", error);
        }
    });

    // Handle reconnections
    (provider.websocket as any).on("close", (code: number, reason: string) => {
        console.warn(`WebSocket connection closed (code: ${code}, reason: ${reason}). Reconnecting in 5s...`);
        setTimeout(startBlockchainListener, 5000);
    });

    (provider.websocket as any).on("error", (error: any) => {
        console.error("WebSocket error detected:", error);
    });
}
