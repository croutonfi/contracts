import { Config } from '@ton/blueprint';

const NETWORK = process.env.NETWORK || 'testnet';
const NETWORK_CONFIGS = {
    mainnet: {
        endpoint: 'https://toncenter.com/api/v2/jsonRPC',
        type: 'mainnet',
        version: 'v2',
        key: process.env.TONCENTER_API_KEY,
    },
    testnet: {
        endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
        type: 'testnet',
        version: 'v2',
        key: process.env.TONCENTER_API_KEY,
    },
} as const;

if (NETWORK !== 'mainnet' && NETWORK !== 'testnet') {
    throw new Error('Invalid network');
}

const config: Config = {
    separateCompilables: true,
    network: NETWORK_CONFIGS[NETWORK],
};

export { config };
