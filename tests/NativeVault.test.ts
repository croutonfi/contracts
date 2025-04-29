import { beginCell, Cell, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import {
    BlankContractCode,
    MockContractCode,
    NativeVaultCode,
} from '../compilables';
import {
    JettonWallet,
    packPoolDeployConfigToCell,
    serializeAssetsToCell,
} from '../wrappers';
import { MockContract } from '../wrappers/MockContract';
import { Vault } from '../wrappers/Vault';
import {
    buildUpgradeMessage,
    buildWithdrawJettonsMessage,
    buildWithdrawTonMessage,
} from '../wrappers/admin';
import { ContractType } from '../wrappers/common';
import { Errors, Op, PoolConfig } from '../wrappers/constants';
import {
    buildNativeToken,
    storeNativeToken,
    TokenType,
} from '../wrappers/tokens';
import { deployJettonMaster } from './helpers/jettons';
import { createJettonAsset, createNativeAsset } from './helpers/pools';
import { addNativeLiquidity, payoutMessage } from './helpers/vaults';

describe('NativeVault', () => {
    let deployer: SandboxContract<TreasuryContract>;
    let vault: SandboxContract<Vault>;

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');

        vault = blockchain.openContract(
            Vault.createFromConfig(
                {
                    factoryAddress: deployer.address,
                    token: buildNativeToken(),
                },
                await BlankContractCode,
                await NativeVaultCode,
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
    });

    describe('init', () => {
        it('should be deployed correctly with jetton_wallet_address set', async () => {
            const [factoryAddress, contractType, token] =
                await vault.getVaultData();

            expect(factoryAddress).toEqualAddress(deployer.address);
            expect(contractType).toEqual(ContractType.Vault);
            expect(token.type).toEqual(TokenType.Native);
        });

        it('should be able to send funds to vault', async () => {
            const user = await blockchain.treasury('user');
            const pool = await blockchain.treasury('pool');

            const { balance: prevBalance } = await vault.getState();
            const amount = toNano('1000');

            const transferResult = await addNativeLiquidity(
                vault,
                amount,
                pool,
                user,
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: user.address,
                to: vault.address,
                op: Op.add_liquidity,
                success: true,
            });

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: deployer.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            const state = await vault.getState();

            expect(state.balance).toBeGreaterThanOrEqual(prevBalance + amount);
        });
    });

    describe('swap', () => {
        it('should be able to process swap in transfer notification and swap_notification to Pool', async () => {
            const user = await blockchain.treasury('user');
            const pool = await blockchain.treasury('pool');

            const amount = toNano('1000');

            const body = beginCell()
                .storeUint(Op.swap, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeRef(
                    beginCell()
                        .storeAddress(pool.address)
                        .storeWritable(storeNativeToken)
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

            const transferResult = await vault.sendMessage(
                user.getSender(),
                body,
                amount + toNano('0.3'),
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: vault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });

            const state = await vault.getState();
            expect(state.balance).toBeGreaterThanOrEqual(amount);
        });
    });

    describe('payout', () => {
        it('should handle payout from pool', async () => {
            const user = await blockchain.treasury('user');

            const jettonMaster = await deployJettonMaster();
            const poolAssets = [
                createJettonAsset(jettonMaster),
                createNativeAsset(),
            ];

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

            const message = beginCell()
                .storeUint(Op.add_liquidity, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(mockPool.address)
                .storeUint(0, 8)
                .storeCoins(0)
                .endCell();

            await vault.sendMessage(
                user.getSender(),
                message,
                amount + toNano('0.4'),
            );

            const userBalance = await user.getBalance();

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

            expect(await user.getBalance()).toBeGreaterThanOrEqual(
                userBalance + amount,
            );
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
            const jettonMaster = await deployJettonMaster();
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
