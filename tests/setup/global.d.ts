import { Blockchain } from '@ton/sandbox';

declare global {
    var now: number;
    var blockchain: Blockchain;
}
