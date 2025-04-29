import { beginCell, Cell, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import {
    BlankContractCode,
    JettonVaultCode,
    MockContractCode,
} from '../compilables';
import { packPoolDeployConfigToCell, serializeAssetsToCell } from '../wrappers';
import { MockContract } from '../wrappers/MockContract';
import { Vault } from '../wrappers/Vault';
import {
    buildUpgradeMessage,
    buildWithdrawJettonsMessage,
    buildWithdrawTonMessage,
} from '../wrappers/admin';
import { ContractType } from '../wrappers/common';
import { Errors, Op, PoolConfig } from '../wrappers/constants';
import { JettonMaster } from '../wrappers/jetton/JettonMaster';
import { JettonWallet } from '../wrappers/jetton/JettonWallet';
import { buildJettonToken, storeJettonToken } from '../wrappers/tokens';
import { deployFactory } from './helpers/factory';
import { deployJettonMaster } from './helpers/jettons';
import { createJettonAsset } from './helpers/pools';
import { addJettonLiquidity, payoutMessage } from './helpers/vaults';

describe('Vault', () => {
    let jettonMaster: SandboxContract<JettonMaster>;

    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<TreasuryContract>;
    let vault: SandboxContract<Vault>;

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');
        pool = await blockchain.treasury('pool');

        jettonMaster = await deployJettonMaster();

        vault = blockchain.openContract(
            Vault.createFromConfig(
                {
                    factoryAddress: deployer.address,
                    token: buildJettonToken(jettonMaster.address),
                },
                await BlankContractCode,
                await JettonVaultCode,
            ),
        );

        const result = await vault.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(result.transactions).toHaveTransaction({
            to: vault.address,
            deploy: true,
            success: true,
        });

        expect(result.transactions).toHaveTransaction({
            to: jettonMaster.address,
            op: Op.provide_wallet_address,
            success: true,
        });

        expect(result.transactions).toHaveTransaction({
            to: vault.address,
            op: Op.take_wallet_address,
            success: true,
        });
    });

    describe('init', () => {
        it('should be deployed correctly', async () => {
            const [factoryAddress, contractType, token] =
                await vault.getVaultData();

            expect(factoryAddress).toEqualAddress(deployer.address);
            expect(contractType).toEqual(ContractType.Vault);
            expect(token.jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
        });
    });

    describe('add liquidity', () => {
        it('should be able to send funds to vault', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            await jettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
                toNano('0.2'),
                toNano('0.5'),
                0,
                0n,
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: deployer.address,
                op: Op.add_liquidity_notification,
                success: true,
            });
            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(vault.address),
                ),
            );
            expect(await vaultWallet.getJettonBalance()).toEqual(amount);
        });

        it('should return jettons if wrong jetton was sent', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            const wrongJettonMaster = await deployJettonMaster();

            await wrongJettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await wrongJettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
                toNano('0.2'),
                toNano('0.5'),
                0,
                0n,
            );

            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await wrongJettonMaster.getWalletAddress(vault.address),
                ),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(transferResult.transactions).toHaveTransaction({
                from: vaultWallet.address,
                to: wallet.address,
                op: Op.internal_transfer,
                success: true,
            });

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });

        it('should return jettons if no fwd_payload was sent', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            await jettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await wallet.sendTransfer(
                user.getSender(),
                toNano('0.7'),
                amount,
                vault.address,
                user.address,
                Cell.EMPTY,
                toNano('0.5'),
                null,
            );

            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(vault.address),
                ),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });

        it('should return jettons if fwd_fee is less then vault add liquidity fee', async () => {
            const { factory } = await deployFactory();
            const [addLiquidityJettonFee, addLiquidityFee] =
                await factory.getAddLiquidityFee(false);

            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            await jettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee - 1n,
                0,
                0n,
            );

            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(vault.address),
                ),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });
    });

    describe('swap', () => {
        const swapFwdPayload = (
            amount: bigint,
            user: SandboxContract<TreasuryContract>,
            pool: SandboxContract<TreasuryContract>,
            jettonMaster: SandboxContract<JettonMaster>,
        ) => {
            return beginCell()
                .storeUint(Op.swap, 32)
                .storeRef(
                    beginCell()
                        .storeAddress(pool.address)
                        .storeWritable(storeJettonToken(jettonMaster.address))
                        .storeCoins(amount)
                        .storeMaybeRef(null)
                        .endCell(),
                )
                .storeRef(
                    beginCell()
                        .storeAddress(user.address)
                        .storeUint(0, 64)
                        .storeMaybeRef(null)
                        .storeMaybeRef(null)
                        .endCell(),
                )
                .endCell();
        };

        it('should be able to process swap in transfer notification and swap_notification to Pool', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            await jettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await wallet.sendTransfer(
                user.getSender(),
                toNano('0.5'),
                amount,
                vault.address,
                user.address,
                Cell.EMPTY,
                toNano('0.25'),
                swapFwdPayload(amount, user, pool, jettonMaster),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });
        });

        it('should return if sent wrong jetton', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            const wrongJettonMaster = await deployJettonMaster();
            await wrongJettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await wrongJettonMaster.getWalletAddress(user.address),
                ),
            );

            const transferResult = await wallet.sendTransfer(
                user.getSender(),
                toNano('0.5'),
                amount,
                vault.address,
                user.address,
                Cell.EMPTY,
                toNano('0.25'),
                swapFwdPayload(amount, user, pool, wrongJettonMaster),
            );

            const vaultWallet = blockchain.openContract(
                JettonMaster.createFromAddress(
                    await wrongJettonMaster.getWalletAddress(vault.address),
                ),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(transferResult.transactions).toHaveTransaction({
                from: vaultWallet.address,
                to: wallet.address,
                op: Op.internal_transfer,
                success: true,
            });

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });

        it('should return if fee is less then vault swap fee', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');

            await jettonMaster.sendMint(
                deployer.getSender(),
                user.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(user.address),
                ),
            );

            const { factory } = await deployFactory();
            const [swapJettonFee, swapFee] = await factory.getSwapFee(false);

            const transferResult = await wallet.sendTransfer(
                user.getSender(),
                swapJettonFee + swapFee,
                amount,
                vault.address,
                user.address,
                Cell.EMPTY,
                swapFee - 1n,
                swapFwdPayload(amount, user, pool, jettonMaster),
            );

            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(vault.address),
                ),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });
    });

    describe('payout', () => {
        it('should handle payout from pool', async () => {
            const user = await blockchain.treasury('user');

            const jettonMaster2 = await deployJettonMaster();
            const poolAssets = [jettonMaster, jettonMaster2].map((contract) =>
                createJettonAsset(contract),
            );

            const poolState = packPoolDeployConfigToCell({
                factoryAddress: deployer.address,
                assets: poolAssets,
                A: PoolConfig.default_A,
            });
            const mockPool = blockchain.openContract(
                MockContract.createFromConfig(
                    poolState,
                    await BlankContractCode,
                    await MockContractCode,
                ),
            );
            await mockPool.sendDeploy(deployer.getSender(), toNano('0.5'));

            const amount = toNano('1000');
            await jettonMaster.sendMint(
                deployer.getSender(),
                vault.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );

            const result = await mockPool.sendForwardMessage(
                deployer.getSender(),
                toNano('1'),
                vault.address,
                payoutMessage(
                    user.address,
                    amount,
                    serializeAssetsToCell(poolAssets),
                ),
            );

            expect(result.transactions).toHaveTransaction({
                from: mockPool.address,
                to: vault.address,
                op: Op.payout,
                success: true,
            });

            const wallet = blockchain.openContract(
                await jettonMaster.getWallet(user.address),
            );

            expect(await wallet.getJettonBalance()).toEqual(amount);
        });
    });

    describe('withdraw jettons', () => {
        it('should be able to withdraw jettons', async () => {
            const user = await blockchain.treasury('user');
            const someJettonMaster = await deployJettonMaster();

            const amount = toNano('1000');
            await someJettonMaster.sendMint(
                deployer.getSender(),
                vault.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );
            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await someJettonMaster.getWalletAddress(vault.address),
                ),
            );
            const wallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await someJettonMaster.getWalletAddress(user.address),
                ),
            );

            const result = await vault.sendMessage(
                deployer.getSender(),
                buildWithdrawJettonsMessage(
                    await someJettonMaster.getWalletAddress(vault.address),
                    user.address,
                    amount,
                ),
            );

            expect(result.transactions).toHaveTransaction({
                from: vault.address,
                to: vaultWallet.address,
                op: Op.transfer,
                success: true,
            });

            expect(await vaultWallet.getJettonBalance()).toEqual(0n);
            expect(await wallet.getJettonBalance()).toEqual(amount);
        });

        it('should throw if not called by factory', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');
            await jettonMaster.sendMint(
                deployer.getSender(),
                vault.address,
                amount,
                toNano('0.025'),
                toNano('0.05'),
            );

            const result = await vault.sendMessage(
                user.getSender(),
                buildWithdrawJettonsMessage(
                    await jettonMaster.getWalletAddress(vault.address),
                    user.address,
                    amount,
                ),
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: vault.address,
                op: Op.withdraw_jettons,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('withdraw tons', () => {
        it('should be able to withdraw jettons', async () => {
            const user = await blockchain.treasury('user');

            const amount = toNano('1000');
            await deployer.getSender().send({
                to: vault.address,
                value: amount,
                bounce: false,
            });

            const balance = await user.getBalance();

            const result = await vault.sendMessage(
                deployer.getSender(),
                buildWithdrawTonMessage(user.address, amount),
            );

            expect(result.transactions).toHaveTransaction({
                from: vault.address,
                to: user.address,
                op: Op.transfer,
                success: true,
            });

            expect(await user.getBalance()).toBeGreaterThanOrEqual(
                balance + amount,
            );
        });

        it('should throw if not called by factory', async () => {
            const user = await blockchain.treasury('user');

            const result = await vault.sendMessage(
                user.getSender(),
                buildWithdrawTonMessage(user.address, toNano('42')),
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: vault.address,
                op: Op.withdraw_tons,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('upgrade', () => {
        it('should be able to upgrade', async () => {
            const newCode = await MockContractCode;

            const dummyInitMessage = beginCell()
                .storeUint(Op.initialize, 32)
                .storeUint(0, 64)
                .endCell();

            const result = await vault.sendMessage(
                deployer.getSender(),
                buildUpgradeMessage(newCode, dummyInitMessage),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: vault.address,
                op: Op.upgrade,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                from: vault.address,
                to: vault.address,
                op: Op.initialize,
                success: true,
                body: dummyInitMessage,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(vault.address),
            );
            const { state } = await mockContract.getState();

            if (state.type !== 'active') {
                throw new Error('State is not active');
            }
            const actualCode = Cell.fromBoc(state.code!)[0];

            expect(actualCode.hash()).toEqual(newCode.hash());
        });

        it('should be able to upgrade with empty fwd msg', async () => {
            const newCode = await MockContractCode;

            const result = await vault.sendMessage(
                deployer.getSender(),
                buildUpgradeMessage(newCode),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: vault.address,
                op: Op.upgrade,
                success: true,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(vault.address),
            );
            const { state } = await mockContract.getState();

            if (state.type !== 'active') {
                throw new Error('State is not active');
            }
            const actualCode = Cell.fromBoc(state.code!)[0];

            expect(actualCode.hash()).toEqual(newCode.hash());
        });

        it('should throw if sender is not factory', async () => {
            const user = await blockchain.treasury('user');

            const result = await vault.sendMessage(
                user.getSender(),
                buildUpgradeMessage(Cell.EMPTY),
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: vault.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });
});
