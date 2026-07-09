// src/constants.ts
// Liste non-exhaustive d'adresses de services pouvant servir à masquer l'origine des fonds
// sur la blockchain Polygon (Mainnet).

export const KNOWN_ENTITIES: Record<string, { type: 'bridge' | 'swap_service' | 'cex' | 'dex', name: string }> = {
    // === PRIVACY SWAPS / NO KYC ===
    '0x2235921fcb6122d287bb16f5c86c1dd68cd4e463': { type: 'swap_service', name: 'SideShift.ai' },
    '0x4de35c441f3e7a3ab005f771ae2300bba80ad8fb': { type: 'swap_service', name: 'ChangeNOW' },
    '0x021badb8f0653df39864cc1f298818f977fcb400': { type: 'swap_service', name: 'FixedFloat' },
    '0x9696f59e4d72e237be84ffd425dcad154bf96976': { type: 'swap_service', name: 'SimpleSwap' },
    '0xb5d85cbf7cb22960f22fb48aa0c38260a92f0365': { type: 'swap_service', name: 'StealthEX' },
    
    // === BRIDGES ===
    '0x3a23f943181408eac424116af7b7790c94cb97a5': { type: 'bridge', name: 'Polygon PoS Bridge' },
    '0xd2f3b72c9bc0d2f09a12cf464bfdcb1578f7eccc': { type: 'bridge', name: 'Hop Protocol' },
    '0x8731d54e9d02c286767d56ac03e8037c07e01e98': { type: 'bridge', name: 'Stargate Finance Bridge' },
    '0x4101e4ec9d9361ad3bc636c0bfeb3bd6769f34f8': { type: 'bridge', name: 'Across Protocol' },
    '0xe204eeb6d05acccfd5e7774ba9dc29feeff6db4c': { type: 'bridge', name: 'Axelar Gateway' },
    '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae': { type: 'bridge', name: 'LiFi Smart Routing' },
    '0x72a19342e8f1838460ebfccef09f6585e32db86e': { type: 'bridge', name: 'Wormhole Token Bridge' },

    // === CEX HOT WALLETS (Usually OK, but if no other activity -> isolation) ===
    '0x77ee191d8ddfd98471da324b17208d2342ecbba6': { type: 'cex', name: 'Binance' },
    '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { type: 'cex', name: 'Binance 2' },
    '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245': { type: 'cex', name: 'Kraken' },
    '0x64dd38fa0999aa7cdbf78ee8aa7c54ef48ae0c1a': { type: 'cex', name: 'Coinbase' },
    '0x5041ed759dd4afc3a72b8192c143f72f4724081a': { type: 'cex', name: 'Bitfinex' },
    '0x9bd7de3501ad47bc479a838b02fc6165ffcd84f9': { type: 'cex', name: 'OKX' }
};

// Check if an address belongs to a known entity
export function identifyEntity(address: string | null): { type: string, name: string } | null {
    if (!address) return null;
    const lower = address.toLowerCase();
    return KNOWN_ENTITIES[lower] || null;
}
