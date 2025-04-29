import { beginCell, Cell, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import {
    BlankContractCode,
    JettonVaultCode,
    LiquidityDepositCode,
    MockContractCode,
    NativeVaultCode,
    PoolCode,
    SharesWalletCode,
} from '../compilables';
import { Vault } from '../wrappers';
import {
    buildUpdateFeesMessage,
    buildWithdrawAdminFeesMessage,
} from '../wrappers/admin';
import { ContractType } from '../wrappers/common';
import { Errors, FEE_DENOMINATOR, Op, PoolConfig } from '../wrappers/constants';
import { Factory } from '../wrappers/Factory';
import { JettonMaster } from '../wrappers/jetton/JettonMaster';
import { JettonWallet } from '../wrappers/jetton/JettonWallet';
import { MockContract } from '../wrappers/MockContract';
import {
    Asset,
    calcAssetRateAndPrecision,
    deserealizeAssetsFromCell,
    prepareSwapParameters,
} from '../wrappers/Pool';
import {
    buildJettonToken,
    buildNativeToken,
    readToken,
    TokenType,
} from '../wrappers/tokens';
import { deployFactory } from './helpers/factory';
import { deployJettonMaster, mintJettons } from './helpers/jettons';
import { createLiquidityDeposit } from './helpers/liquidity_deposit';
import {
    createJettonAsset,
    createNativeAsset,
    createRates,
    deployPool,
    deployPoolTestingSetup,
} from './helpers/pools';
import {
    addJettonLiquidity,
    addNativeLiquidity,
    deployJettonVault,
    deployNativeVault,
} from './helpers/vaults';

describe('Factory', () => {
    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;

    let jettonMaster: SandboxContract<JettonMaster>;
    let jettonMaster2: SandboxContract<JettonMaster>;

    let factory: SandboxContract<Factory>;

    const userSeed = 'some-user';

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury(userSeed);

        let { factory: deployedFactory, result } = await deployFactory();

        factory = deployedFactory;

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: factory.address,
            deploy: true,
            success: true,
        });

        const ownerAddress = await factory.getOwnerAddress();
        expect(ownerAddress).toEqualAddress(deployer.address);

        jettonMaster = await deployJettonMaster();
        jettonMaster2 = await deployJettonMaster();
    });

    describe('vault deployment', () => {
        it('should be able to deploy a Vault', async () => {
            const { result, vault } = await deployJettonVault(
                factory,
                jettonMaster,
            );

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: vault.address,
                deploy: true,
                success: true,
            });
        });

        it('should be able to deploy a NativeVault', async () => {
            const { result, vault } = await deployNativeVault(factory);

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: vault.address,
                deploy: true,
                success: true,
            });
        });

        it('should reject Vault deploy if not called by owner', async () => {
            const { result } = await deployJettonVault(
                factory,
                jettonMaster,
                userSeed,
            );
            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });

        it('should reject NativeVault deploy if not called by owner', async () => {
            const { result } = await deployNativeVault(factory, userSeed);

            const user = await blockchain.treasury(userSeed);

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('pool deployment', () => {
        it('should be able to deploy a Pool with 3 random jetton assets', async () => {
            const assets: Asset[] = (await blockchain.createWallets(3)).map(
                (contract) => createJettonAsset(contract),
            );
            const { pool, result } = await deployPool(factory, assets);

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: pool.address,
                deploy: true,
                success: true,
            });
        });

        it('should be able to deploy a Pool with 2 random jetton assets and native token', async () => {
            const assets: Asset[] = (await blockchain.createWallets(2)).map(
                (contract) => createJettonAsset(contract),
            );
            assets.push(createNativeAsset());

            const { pool, result } = await deployPool(factory, assets);

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: pool.address,
                deploy: true,
                success: true,
            });
        });

        it('should reject Pool deploy if not called by owner', async () => {
            const assets: Asset[] = (await blockchain.createWallets(2)).map(
                (contract) => createJettonAsset(contract),
            );

            const { result } = await deployPool(
                factory,
                assets,
                createRates(assets.length),
                PoolConfig.default_A,
                0n,
                0n,
                userSeed,
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('liquidity deposit', () => {
        it('should be able to deploy a LiquidityDeposit and send a deposit_notification', async () => {
            const { result, vault } = await deployJettonVault(
                factory,
                jettonMaster,
            );

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: vault.address,
                deploy: true,
                success: true,
            });

            const user = await blockchain.treasury('user');
            const pool = await blockchain.treasury('pool');

            const amount = toNano('1000');

            await mintJettons(jettonMaster, user.address, amount);
            const wallet = blockchain.openContract(
                await jettonMaster.getWallet(user.address),
            );
            expect(await wallet.getJettonBalance()).toEqual(amount);

            const addLiquidityResult = await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
            );
            expect(addLiquidityResult.transactions).toHaveTransaction({
                from: vault.address,
                to: factory.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            const vaultWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMaster.getWalletAddress(vault.address),
                ),
            );
            expect(await vaultWallet.getJettonBalance()).toEqual(amount);

            const liquidityDeposit = blockchain.openContract(
                await createLiquidityDeposit(factory, user, pool),
            );

            expect(
                await factory.getLiquidityDepositAddress(
                    user.address,
                    pool.address,
                ),
            ).toEqualAddress(liquidityDeposit.address);

            expect(addLiquidityResult.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: liquidityDeposit.address,
                op: Op.deposit_notification,
                success: true,
            });

            const [
                factoryAddress,
                contractType,
                ownerAddress,
                poolAddress,
                jettons,
                balances,
            ] = await liquidityDeposit.getLiquidityDepositData();

            expect(factoryAddress).toEqualAddress(factory.address);
            expect(contractType).toEqual(ContractType.LiquidityDeposit);
            expect(ownerAddress).toEqualAddress(user.address);
            expect(poolAddress).toEqualAddress(pool.address);

            expect(readToken(jettons).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(balances.readBigNumber()).toEqual(amount);
        });

        it('should be able to deploy Pool with LiquidityDeposit and initial liquidity', async () => {
            const { vault } = await deployJettonVault(factory, jettonMaster);
            const { vault: vault2 } = await deployJettonVault(
                factory,
                jettonMaster2,
            );
            const { vault: nativeVault } = await deployNativeVault(factory);

            const poolAssets = [jettonMaster, jettonMaster2].map((contract) =>
                createJettonAsset(contract),
            );
            poolAssets.push(createNativeAsset());

            const { pool, result: poolDeploymentResult } = await deployPool(
                factory,
                poolAssets,
            );

            expect(poolDeploymentResult.transactions).toHaveTransaction({
                from: factory.address,
                to: pool.address,
                deploy: true,
                success: true,
            });

            const user = await blockchain.treasury('user');
            const amount = toNano('1000');

            await mintJettons(jettonMaster, user.address, amount);
            const wallet = blockchain.openContract(
                await jettonMaster.getWallet(user.address),
            );
            expect(await wallet.getJettonBalance()).toEqual(amount);

            const [addLiquidityJettonFee, addLiquidityFee] =
                await factory.getAddLiquidityFee();

            const addLiquidityResult = await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee,
            );
            expect(addLiquidityResult.transactions).toHaveTransaction({
                from: vault.address,
                to: factory.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            await mintJettons(jettonMaster2, user.address, amount);
            const wallet2 = blockchain.openContract(
                await jettonMaster2.getWallet(user.address),
            );
            expect(await wallet2.getJettonBalance()).toEqual(amount);

            const addLiquidity2Result = await addJettonLiquidity(
                vault2,
                wallet2,
                amount,
                pool,
                user,
            );
            expect(addLiquidity2Result.transactions).toHaveTransaction({
                from: vault2.address,
                to: factory.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            const addLiquidityNativeResult = await addNativeLiquidity(
                nativeVault,
                amount,
                pool,
                user,
                addLiquidityFee,
            );
            expect(addLiquidityNativeResult.transactions).toHaveTransaction({
                from: nativeVault.address,
                to: factory.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            const liquidityDeposit = blockchain.openContract(
                await createLiquidityDeposit(factory, user, pool),
            );
            const [, , , , tokens, balances] =
                await liquidityDeposit.getLiquidityDepositData();

            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster2.address,
            );
            expect(readToken(tokens).type).toEqual(TokenType.Native);

            expect(balances.readBigNumber()).toEqual(amount);
            expect(balances.readBigNumber()).toEqual(amount);
            expect(balances.readBigNumber()).toEqual(amount);

            const depositAllFee = await factory.getDepositAllFee();
            const depositAllResult = await liquidityDeposit.sendDepositAll(
                user.getSender(),
                depositAllFee,
            );

            expect(depositAllResult.transactions).toHaveTransaction({
                to: liquidityDeposit.address,
                op: Op.deposit_all,
                success: true,
                endStatus: 'non-existing',
            });
            expect(depositAllResult.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });

            const usersSharesWallet = blockchain.openContract(
                JettonWallet.createFromConfig(
                    {
                        balance: 0n,
                        ownerAddress: user.address,
                        jettonMasterAddress: pool.address,
                        jettonWalletCode: await SharesWalletCode,
                    },
                    await SharesWalletCode,
                ),
            );

            expect(depositAllResult.transactions).toHaveTransaction({
                from: pool.address,
                to: usersSharesWallet.address,
                deploy: true,
                success: true,
            });
            expect(depositAllResult.transactions).toHaveTransaction({
                from: usersSharesWallet.address,
                to: user.address,
                op: Op.excesses,
                success: true,
            });

            const sharesBalance = await usersSharesWallet.getJettonBalance();
            expect(sharesBalance).toBe(amount * 3n);

            const poolAssetsCell = (await pool.getPoolData()).assets;
            const poolNewAssets = deserealizeAssetsFromCell(poolAssetsCell);

            expect(poolNewAssets[0].token.jettonMasterAddress).toEqualAddress(
                poolAssets[0].token.jettonMasterAddress!,
            );
            expect(poolNewAssets[0].balance).toEqual(amount);

            expect(poolNewAssets[1].token.jettonMasterAddress).toEqualAddress(
                poolAssets[1].token.jettonMasterAddress!,
            );
            expect(poolNewAssets[1].balance).toEqual(amount);

            expect(poolNewAssets[2].token.type).toEqual(TokenType.Native);
            expect(poolNewAssets[2].balance).toEqual(amount);
        });
    });

    describe('admin action', () => {
        it('admin action', async () => {
            const pool = await blockchain.treasury('pool');
            const msgPayload = buildUpdateFeesMessage(0n, 0n);

            const result = await factory.sendAdminAction(
                deployer.getSender(),
                toNano('0.1'),
                pool.address,
                0n,
                msgPayload,
            );

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: pool.address,
                op: Op.update_fees,
                success: true,
            });
        });

        it('should throw if not called by owner', async () => {
            const result = await factory.sendAdminAction(
                user.getSender(),
                toNano('0.1'),
                deployer.address,
                0n,
                Cell.EMPTY,
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });

        it('should not allow to drain factory balance', async () => {
            await deployer.getSender().send({
                to: factory.address,
                value: toNano('1'),
                bounce: false,
            });

            const amount = toNano('0.42');

            const result = await factory.sendAdminAction(
                deployer.getSender(),
                amount,
                deployer.address,
                amount + 1n,
                Cell.EMPTY,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                success: false,
                exitCode: Errors.not_enough_ton,
            });
        });

        describe('withdraw admin fees from pool', () => {
            it('should allow to withdraw admin fees from pool', async () => {
                const DEFAULT_TOKEN_DECIMALS = 8n;
                const DEFAULT_ASSET_PARAMETERS = {
                    ...calcAssetRateAndPrecision(DEFAULT_TOKEN_DECIMALS),
                    tokenType: TokenType.Jetton,
                };
                const initialLiquidity = 1_000_000_000n;
                const feeRaw = 0.003; // 0.3%
                const fee = BigInt(
                    Math.floor(feeRaw * Number(FEE_DENOMINATOR)),
                );

                const adminFee = FEE_DENOMINATOR / 2n; // half of fees go to admin

                const { user, jettonMasters, vaults, pool } =
                    await deployPoolTestingSetup({
                        factory,
                        assetConfig: [
                            {
                                ...DEFAULT_ASSET_PARAMETERS,
                                initialLiquidity,
                            },
                            {
                                ...DEFAULT_ASSET_PARAMETERS,
                                initialLiquidity,
                            },
                            {
                                ...DEFAULT_ASSET_PARAMETERS,
                                initialLiquidity,
                            },
                        ],
                        A: 200n,
                        adminFee,
                        fee,
                    });

                const amountIn = 100_000n;

                const fromJetton = jettonMasters[0];
                const toJetton = jettonMasters[1];

                const fromJettonVault = vaults[0];
                const toJettonVault = vaults[1];

                // mint some jettons to user
                await mintJettons(fromJetton, user.address, amountIn);

                const toJettonUserWallet = blockchain.openContract(
                    await toJetton.getWallet(user.address),
                );
                const initialUserBalance =
                    await toJettonUserWallet.getJettonBalance();

                const fromJettonUserWallet = blockchain.openContract(
                    await fromJetton.getWallet(user.address),
                );

                const estimatedAmountOut = await pool.getDy(0, 1, amountIn);

                const fwdPayload = prepareSwapParameters(
                    [
                        {
                            pool: pool.address,
                            toToken: buildJettonToken(toJetton.address),
                            limit: estimatedAmountOut,
                        },
                    ],
                    {
                        recipient: user.address,
                        deadline: Math.floor(Date.now() / 1000) + 100000,
                        successPayload: null,
                        failPayload: null,
                    },
                );

                const [swapJettonFee, swapFee] = await factory.getSwapFee();
                await fromJettonUserWallet.sendTransfer(
                    user.getSender(),
                    swapFee + swapJettonFee,
                    amountIn,
                    fromJettonVault.address,
                    user.address,
                    Cell.EMPTY,
                    swapFee,
                    fwdPayload,
                );

                const adminFeeBalances = await pool.getAdminFeeBalances();

                expect(adminFeeBalances[1]).toBeGreaterThan(0);

                const feeReceiver = await blockchain.treasury('feeReceiver');
                const msgPayload = buildWithdrawAdminFeesMessage(
                    buildJettonToken(jettonMasters[1].address),
                    feeReceiver.address,
                    adminFeeBalances[1],
                );
                const feeReceiverWallet = blockchain.openContract(
                    await jettonMasters[1].getWallet(feeReceiver.address),
                );

                const result = await factory.sendAdminAction(
                    deployer.getSender(),
                    toNano('0.1'),
                    pool.address,
                    0n,
                    msgPayload,
                );

                expect(result.transactions).toHaveTransaction({
                    from: factory.address,
                    to: pool.address,
                    op: Op.withdraw_admin_fees,
                    success: true,
                });

                expect(result.transactions).toHaveTransaction({
                    from: pool.address,
                    to: vaults[1].address,
                    op: Op.payout,
                    success: true,
                });

                const vaultWalletAddress =
                    await jettonMasters[1].getWalletAddress(vaults[1].address);

                expect(result.transactions).toHaveTransaction({
                    from: vaultWalletAddress,
                    to: feeReceiverWallet.address,
                    op: Op.internal_transfer,
                    success: true,
                });

                expect(await feeReceiverWallet.getJettonBalance()).toEqual(
                    adminFeeBalances[1],
                );
            });
        });
    });

    describe('code update', () => {
        const dummyCode = beginCell().storeUint(42, 8).endCell();

        it('should be able to update jetton vault code', async () => {
            const vaultCodes = beginCell()
                .storeRef(dummyCode)
                .storeRef(await NativeVaultCode)
                .endCell();

            const result = await factory.sendUpdateCode(
                deployer.getSender(),
                ContractType.Vault,
                vaultCodes,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.update_code,
                success: true,
            });

            const { jettonVaultCode } = await factory.getCode();

            expect(jettonVaultCode.hash()).toEqual(dummyCode.hash());
        });

        it('should be able to update native vault code', async () => {
            const vaultCodes = beginCell()
                .storeRef(await JettonVaultCode)
                .storeRef(dummyCode)
                .endCell();

            const result = await factory.sendUpdateCode(
                deployer.getSender(),
                ContractType.Vault,
                vaultCodes,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.update_code,
                success: true,
            });

            const { nativeVaultCode } = await factory.getCode();

            expect(nativeVaultCode.hash()).toEqual(dummyCode.hash());
        });

        it('should be able to update pool code', async () => {
            const result = await factory.sendUpdateCode(
                deployer.getSender(),
                ContractType.Pool,
                dummyCode,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.update_code,
                success: true,
            });

            const { poolCode } = await factory.getCode();

            expect(poolCode.hash()).toEqual(dummyCode.hash());
        });

        it('should be able to update liquidity deposit code', async () => {
            const result = await factory.sendUpdateCode(
                deployer.getSender(),
                ContractType.LiquidityDeposit,
                dummyCode,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.update_code,
                success: true,
            });

            const { liquidityDepositCode } = await factory.getCode();
            expect(liquidityDepositCode.hash()).toEqual(dummyCode.hash());
        });

        it('should throw if trying to update vault codes with one cell', async () => {
            await expect(
                factory.sendUpdateCode(
                    deployer.getSender(),
                    ContractType.Vault,
                    dummyCode,
                ),
            ).rejects.toThrow();
        });

        it('should throw if sender is not owner', async () => {
            const result = await factory.sendUpdateCode(
                user.getSender(),
                ContractType.Pool,
                dummyCode,
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('transfer ownership', () => {
        it('should be able to transfer ownership', async () => {
            const newOwner = await blockchain.treasury('newOwner');
            const result = await factory.sendTransferOwnership(
                deployer.getSender(),
                newOwner.address,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.transfer_ownership,
                success: true,
            });

            expect(await factory.getOwnerAddress()).toEqualAddress(
                newOwner.address,
            );
        });

        it('should throw if sender is not owner', async () => {
            const newOwner = await blockchain.treasury('newOwner');
            const result = await factory.sendTransferOwnership(
                user.getSender(),
                newOwner.address,
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });

    describe('getters', () => {
        it('should return correct vault address for native TON', async () => {
            const nativeVaultAddressFromFactory =
                await factory.getVaultAddress(buildNativeToken());

            const nativeVault = blockchain.openContract(
                Vault.createFromConfig(
                    {
                        factoryAddress: factory.address,
                        token: buildNativeToken(),
                    },
                    await BlankContractCode,
                    await NativeVaultCode,
                ),
            );

            expect(nativeVaultAddressFromFactory).toEqualAddress(
                nativeVault.address,
            );
        });

        it('should return correct vault address for Jetton vault', async () => {
            const jettonVaultAddressFromFactory = await factory.getVaultAddress(
                buildJettonToken(jettonMaster.address),
            );

            const jettonVault = blockchain.openContract(
                Vault.createFromConfig(
                    {
                        factoryAddress: factory.address,
                        token: buildJettonToken(jettonMaster.address),
                    },
                    await BlankContractCode,
                    await NativeVaultCode,
                ),
            );

            expect(jettonVaultAddressFromFactory).toEqualAddress(
                jettonVault.address,
            );
        });

        it('should return correct code', async () => {
            const {
                jettonVaultCode,
                nativeVaultCode,
                poolCode,
                liquidityDepositCode,
            } = await factory.getCode();

            expect(jettonVaultCode.hash()).toEqual(
                (await JettonVaultCode).hash(),
            );
            expect(nativeVaultCode.hash()).toEqual(
                (await NativeVaultCode).hash(),
            );
            expect(poolCode.hash()).toEqual((await PoolCode).hash());
            expect(liquidityDepositCode.hash()).toEqual(
                (await LiquidityDepositCode).hash(),
            );
        });
    });

    describe('upgrade', () => {
        it('should be able to upgrade', async () => {
            const newCode = await MockContractCode;

            const dummyInitMessage = beginCell()
                .storeUint(Op.initialize, 32)
                .storeUint(0, 64)
                .endCell();

            const result = await factory.sendUpgrade(
                deployer.getSender(),
                newCode,
                dummyInitMessage,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.upgrade,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                from: factory.address,
                to: factory.address,
                op: Op.initialize,
                success: true,
                body: dummyInitMessage,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(factory.address),
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

            const result = await factory.sendUpgrade(
                deployer.getSender(),
                newCode,
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: factory.address,
                op: Op.upgrade,
                success: true,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(factory.address),
            );
            const { state } = await mockContract.getState();

            if (state.type !== 'active') {
                throw new Error('State is not active');
            }
            const actualCode = Cell.fromBoc(state.code!)[0];

            expect(actualCode.hash()).toEqual(newCode.hash());
        });

        it('should throw if sender is not owner', async () => {
            const result = await factory.sendUpgrade(
                user.getSender(),
                Cell.EMPTY,
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: factory.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });
});
