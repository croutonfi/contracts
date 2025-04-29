import { Cell, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { JettonWalletCode, SharesWalletCode } from '../compilables';
import { JettonMaster } from '../wrappers/jetton/JettonMaster';
import { JettonWallet } from '../wrappers/jetton/JettonWallet';
import { deployJettonMaster } from './helpers/jettons';

describe.each([
    ['JettonWalletCode', JettonWalletCode],
    ['SharesWalletCode', SharesWalletCode],
])('%s', (_, walletCode) => {
    let deployer: SandboxContract<TreasuryContract>;
    let master: SandboxContract<JettonMaster>;

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');
        master = await deployJettonMaster('deployer', walletCode);
    });

    it('should set correct address', async () => {
        expect(await master.getAdminAddress()).toEqualAddress(deployer.address);
    });

    it('should be able to mint', async () => {
        const user = await blockchain.treasury('user');

        const amount = toNano('0.05');

        const result = await master.sendMint(
            deployer.getSender(),
            user.address,
            amount,
            toNano('0.025'),
            toNano('0.05'),
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            deploy: false,
            success: true,
        });

        const wallet = blockchain.openContract(
            JettonWallet.createFromConfig(
                {
                    balance: 0n,
                    ownerAddress: user.address,
                    jettonMasterAddress: master.address,
                    jettonWalletCode: await walletCode,
                },
                await walletCode,
            ),
        );

        expect(await wallet.getJettonBalance()).toEqual(amount);
    });

    it('should be able to transfer to another user', async () => {
        const user = await blockchain.treasury('user');
        const anotherUser = await blockchain.treasury('anotherUser');

        const amount = toNano('10');

        const result = await master.sendMint(
            deployer.getSender(),
            user.address,
            amount,
            toNano('0.025'),
            toNano('0.05'),
        );

        expect(result.transactions).toHaveTransaction({
            from: master.address,
            deploy: true,
            success: true,
        });

        const wallet = blockchain.openContract(
            JettonWallet.createFromAddress(
                await master.getWalletAddress(user.address),
            ),
        );

        expect(await wallet.getJettonBalance()).toEqual(amount);

        const transferResult = await wallet.sendTransfer(
            user.getSender(),
            toNano('0.5'),
            amount,
            anotherUser.address,
            user.address,
            Cell.EMPTY,
            0n,
            Cell.EMPTY,
        );
        expect(transferResult.transactions).toHaveTransaction({
            from: await master.getWalletAddress(user.address),
            to: await master.getWalletAddress(anotherUser.address),
            deploy: true,
            success: true,
        });

        const anotherUserWallet = blockchain.openContract(
            JettonWallet.createFromAddress(
                await master.getWalletAddress(anotherUser.address),
            ),
        );

        expect(await anotherUserWallet.getJettonBalance()).toEqual(amount);
        expect(await wallet.getJettonBalance()).toEqual(0n);
    });
});
