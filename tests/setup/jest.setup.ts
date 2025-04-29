import { Blockchain, BlockchainSnapshot } from '@ton/sandbox';
import '@ton/test-utils';

let snapshot: BlockchainSnapshot;

beforeAll(async () => {
    const blockchain = await Blockchain.create();
    global.blockchain = blockchain;
});

beforeEach(async () => {
    global.now = Math.floor(new Date().getTime() / 1000);
    blockchain.now = global.now;

    snapshot = blockchain?.snapshot();
});

afterEach(async () => {
    await blockchain?.loadFrom(snapshot);
});
