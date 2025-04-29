import { OpenedContract, Sender } from '@ton/core';
import { KeyPair } from '@ton/crypto';
import {
    mnemonicFromRandomSeed,
    mnemonicToWalletKey,
} from '@ton/crypto/dist/mnemonic/mnemonic';
import { WalletContractV4 } from '@ton/ton';

export interface WalletSender {
    wallet: OpenedContract<WalletContractV4>;
    sender: Sender;
}

export const getKeyPair = async (seed: Buffer): Promise<KeyPair> => {
    const mnemonicArray = await mnemonicFromRandomSeed(seed);

    return mnemonicToWalletKey(mnemonicArray);
};
