import { beginCell, Cell, toNano } from '@ton/core';
import { SandboxContract } from '@ton/sandbox';
import '@ton/test-utils';
import { SharesWalletCode } from '../compilables';
import { JettonWallet, Vault } from '../wrappers';
import { FEE_DENOMINATOR, Op } from '../wrappers/constants';
import { Factory } from '../wrappers/Factory';
import {
    calcAssetRateAndPrecision,
    prepareRemoveLiquidityBalancedParameters,
    prepareRemoveLiquidityOneCoinParameters,
    prepareSwapParameters,
} from '../wrappers/Pool';
import { buildJettonToken, TokenType } from '../wrappers/tokens';
import { deployFactory } from './helpers/factory';
import { mintJettons } from './helpers/jettons';
import { AssetConfig, deployPoolTestingSetup } from './helpers/pools';
import { addJettonLiquidity } from './helpers/vaults';

const DEFAULT_TOKEN_DECIMALS = 8n;
const DEFAULT_ASSET_PARAMETERS = calcAssetRateAndPrecision(
    DEFAULT_TOKEN_DECIMALS,
);
const DEFAULT_LIQUIDITY = 9999n;

function generateVariousLiquiditySetups(initialLiquidity: bigint) {
    const N_COINS = [2, 5, 8];

    return N_COINS.map((n) => {
        const config: AssetConfig = [];

        for (let i = 0; i < n; i++) {
            const liquidity = initialLiquidity * DEFAULT_ASSET_PARAMETERS.one;

            config.push({
                ...DEFAULT_ASSET_PARAMETERS,
                initialLiquidity: liquidity,
                tokenType: TokenType.Jetton,
            });
        }

        return [n, { assetConfig: config }] as const;
    });
}

describe('Shares', () => {
    let factory: SandboxContract<Factory>;

    beforeAll(async () => {
        let { factory: deployedFactory } = await deployFactory();

        factory = deployedFactory;
    });

    describe('Basic shares tests', () => {
        it('should not allow adding initial liquidity with less than N_COINS tokens', async () => {
            const { depositAllResult, pool, user, liquidityDeposit } =
                await deployPoolTestingSetup({
                    factory,
                    assetConfig: [
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 100n,
                            tokenType: TokenType.Jetton,
                        },
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 0n,
                            tokenType: TokenType.Jetton,
                        },
                    ],
                    A: 200n,
                    adminFee: 0n,
                    fee: 0n,
                });

            expect(depositAllResult.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: false,
            });
        });

        it('should not allow adding liquidity where minted shares < expected shares', async () => {
            const { pool, user, jettonMasters, liquidityDeposit } =
                await deployPoolTestingSetup({
                    factory,
                    assetConfig: [
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 1000n,
                            tokenType: TokenType.Jetton,
                        },
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 1000n,
                            tokenType: TokenType.Jetton,
                        },
                    ],
                    A: 200n,
                    adminFee: 0n,
                    fee: 0n,
                });

            const testJettonAmount = 42n;
            await mintJettons(jettonMasters[0], user.address, testJettonAmount);

            const vaultAddress = await factory.getVaultAddress(
                buildJettonToken(jettonMasters[0].address),
            );

            const vault = blockchain.openContract(
                Vault.createFromAddress(vaultAddress),
            );

            const userJettonWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMasters[0].getWalletAddress(user.address),
                ),
            );

            const [addLiquidityJettonFee, addLiquidityFee] =
                await factory.getAddLiquidityFee();

            const result = await addJettonLiquidity(
                vault,
                userJettonWallet,
                testJettonAmount,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee,
                1,
                10000000000000000000000000n,
            );

            /*
             * Check that pool will payout all deposited jettons back to user
             */
            expect(result.transactions).toHaveTransaction({
                from: pool.address,
                to: vault.address,
                op: Op.payout,
            });

            expect(result.transactions).toHaveTransaction({
                from: vault.address,
                op: Op.transfer,
            });
        });

        it('should correctly estimate when adding liquidity in one token', async () => {
            const { pool, user, jettonMasters, liquidityDeposit } =
                await deployPoolTestingSetup({
                    factory,
                    assetConfig: [
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity:
                                1000n * DEFAULT_ASSET_PARAMETERS.one,
                            tokenType: TokenType.Jetton,
                        },
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity:
                                1001n * DEFAULT_ASSET_PARAMETERS.one,
                            tokenType: TokenType.Jetton,
                        },
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity:
                                1001n * DEFAULT_ASSET_PARAMETERS.one,
                            tokenType: TokenType.Jetton,
                        },
                    ],
                    A: 200n,
                    adminFee: FEE_DENOMINATOR / 2n,
                    fee: 3000000n,
                });

            const testJettonAmount = 42n * DEFAULT_ASSET_PARAMETERS.one;
            const assetIndex = 1;

            await mintJettons(
                jettonMasters[assetIndex],
                user.address,
                testJettonAmount,
            );

            const vaultAddress = await factory.getVaultAddress(
                buildJettonToken(jettonMasters[assetIndex].address),
            );

            const vault = blockchain.openContract(
                Vault.createFromAddress(vaultAddress),
            );

            const userJettonWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMasters[assetIndex].getWalletAddress(
                        user.address,
                    ),
                ),
            );

            const [addLiquidityJettonFee, addLiquidityFee] =
                await factory.getAddLiquidityFee();

            const sharesEstimateParams = [0n, 0n, 0n];
            sharesEstimateParams[assetIndex] = testJettonAmount;

            const sharesEstimate = await pool.getCalcTokenAmount(
                sharesEstimateParams,
                true,
            );

            const result = await addJettonLiquidity(
                vault,
                userJettonWallet,
                testJettonAmount,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee,
                1,
                sharesEstimate,
            );

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });
        });

        it('should be able to burn minted shares into single asset and account for different rates', async () => {
            // mimick 3TON pool
            const assetConfig: AssetConfig = [
                {
                    rate: 1000000000000000000000000000n,
                    precision: 1000000000n,
                    initialLiquidity: 100000n,
                    tokenType: TokenType.Jetton,
                },
                {
                    rate: 1053573440000000000000000000n,
                    precision: 1000000000n,
                    initialLiquidity: 94915n,
                    tokenType: TokenType.Jetton,
                },
                {
                    rate: 1046677804528141000000000000n,
                    precision: 1000000000n,
                    initialLiquidity: 95540n,
                    tokenType: TokenType.Jetton,
                },
            ];

            const { depositAllResult, pool, vaults, user, jettonMasters } =
                await deployPoolTestingSetup({
                    factory,
                    assetConfig,
                    A: 200n,
                    adminFee: FEE_DENOMINATOR / 2n,
                    fee: 0n,
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

            const sharesBalance = await usersSharesWallet.getJettonBalance();
            const withdrawRatio = 80n; // withdraw 1/80 of shares (to reduce price impact)
            const sharesToWithdraw = sharesBalance / withdrawRatio;
            const tokenToRemove = 2;

            const totalPositionValue = assetConfig.reduce(
                (acc, asset, i) => acc + asset.rate * asset.initialLiquidity,
                0n,
            );

            const estimatedWithdrawal = await pool.getWithdrawOneCoin(
                sharesToWithdraw,
                tokenToRemove,
            );

            expect(estimatedWithdrawal).toBe(
                totalPositionValue /
                    (withdrawRatio * assetConfig[tokenToRemove].rate),
            );

            const burnResult = await usersSharesWallet.sendBurn(
                user.getSender(),
                await factory.getBurnLpFee(assetConfig.length),
                sharesToWithdraw,
                user.address,
                prepareRemoveLiquidityOneCoinParameters(tokenToRemove, 0n),
            );

            expect(burnResult.transactions).toHaveTransaction({
                from: usersSharesWallet.address,
                to: pool.address,
                op: Op.burn_notification,
                success: true,
            });

            expect(burnResult.transactions).toHaveTransaction({
                from: pool.address,
                to: vaults[tokenToRemove].address,
                op: Op.payout,
                success: true,
            });

            expect(burnResult.transactions).not.toHaveTransaction({
                success: false,
            });

            const newSharesBalance = await usersSharesWallet.getJettonBalance();
            expect(newSharesBalance).toBe(sharesBalance - sharesToWithdraw);
        });

        it('should be able estimate amount shares and mint fine without errors', async () => {
            const { pool, user, jettonMasters, liquidityDeposit } =
                await deployPoolTestingSetup({
                    factory,
                    assetConfig: [
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 100n,
                            tokenType: TokenType.Jetton,
                        },
                        {
                            ...DEFAULT_ASSET_PARAMETERS,
                            initialLiquidity: 100n,
                            tokenType: TokenType.Jetton,
                        },
                    ],
                    A: 200n,
                    adminFee: 0n,
                    fee: 0n,
                });

            const amountToInvest = 10n;

            await mintJettons(jettonMasters[0], user.address, amountToInvest);
            await mintJettons(jettonMasters[1], user.address, amountToInvest);

            const sharesEstimate = await pool.getCalcTokenAmount(
                [amountToInvest, amountToInvest],
                true,
            );

            const sharesWallet = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await pool.getSharesWalletAddress(user.address),
                ),
            );

            const vault0 = blockchain.openContract(
                Vault.createFromAddress(
                    await factory.getVaultAddress(
                        buildJettonToken(jettonMasters[0].address),
                    ),
                ),
            );
            const vault1 = blockchain.openContract(
                Vault.createFromAddress(
                    await factory.getVaultAddress(
                        buildJettonToken(jettonMasters[1].address),
                    ),
                ),
            );

            const userJettonWallet0 = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMasters[0].getWalletAddress(user.address),
                ),
            );
            const userJettonWallet1 = blockchain.openContract(
                JettonWallet.createFromAddress(
                    await jettonMasters[1].getWalletAddress(user.address),
                ),
            );

            const [addLiquidityJettonFee, addLiquidityFee] =
                await factory.getAddLiquidityFee();

            const initialSharesBalance = await sharesWallet.getJettonBalance();

            await addJettonLiquidity(
                vault0,
                userJettonWallet0,
                amountToInvest,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee,
                2,
                sharesEstimate,
            );
            const result = await addJettonLiquidity(
                vault1,
                userJettonWallet1,
                amountToInvest,
                pool,
                user,
                addLiquidityJettonFee,
                addLiquidityFee,
                2,
                sharesEstimate,
            );

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });

            const finalSharesBalance = await sharesWallet.getJettonBalance();

            expect(finalSharesBalance - initialSharesBalance).toBe(
                sharesEstimate,
            );
        });

        it('should be able to withdraw shares for two users in heavily imbalanced pool', async () => {
            const initialLiquidity = 100000n;
            const {
                user: user1,
                jettonMasters,
                vaults,
                pool,
            } = await deployPoolTestingSetup({
                factory,
                assetConfig: [
                    {
                        ...DEFAULT_ASSET_PARAMETERS,
                        initialLiquidity,
                        tokenType: TokenType.Jetton,
                    },
                    {
                        ...DEFAULT_ASSET_PARAMETERS,
                        initialLiquidity,
                        tokenType: TokenType.Jetton,
                    },
                    {
                        ...DEFAULT_ASSET_PARAMETERS,
                        initialLiquidity,
                        tokenType: TokenType.Jetton,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

            const user2 = await blockchain.treasury('user2');
            const amountIn = initialLiquidity ** 5n;

            const fromJetton = jettonMasters[0];
            const toJetton = jettonMasters[1];

            const fromJettonVault = vaults[0];
            const toJettonVault = vaults[1];

            // mint some jettons to user
            await mintJettons(fromJetton, user1.address, amountIn);
            await mintJettons(fromJetton, user2.address, amountIn);

            const addUser2JettonResult = await addJettonLiquidity(
                fromJettonVault,
                blockchain.openContract(
                    await fromJetton.getWallet(user2.address),
                ),
                initialLiquidity,
                pool,
                user2,
                toNano('0.6'),
                toNano('0.6'),
                1,
                1n,
            );

            expect(addUser2JettonResult.transactions).not.toHaveTransaction({
                success: false,
            });

            const fromJettonUserWallet = blockchain.openContract(
                await fromJetton.getWallet(user1.address),
            );

            const fwdPayload = prepareSwapParameters(
                [
                    {
                        pool: pool.address,
                        toToken: buildJettonToken(toJetton.address),
                        limit: 1n,
                    },
                ],
                {
                    recipient: user1.address,
                    deadline: Math.floor(Date.now() / 1000) + 100000,
                    successPayload: null,
                    failPayload: null,
                },
            );

            const [swapJettonFee, swapFee] = await factory.getSwapFee();
            const transferResult = await fromJettonUserWallet.sendTransfer(
                user1.getSender(),
                swapFee + swapJettonFee,
                amountIn,
                fromJettonVault.address,
                user1.address,
                Cell.EMPTY,
                swapFee,
                fwdPayload,
            );

            const [, reserve1] = await pool.getBalances();
            expect(reserve1).toBe(1n);

            expect(transferResult.transactions).toHaveTransaction({
                from: fromJettonVault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });

            expect(transferResult.transactions).toHaveTransaction({
                from: pool.address,
                to: toJettonVault.address,
                op: Op.payout,
                success: true,
            });

            expect(transferResult.transactions).not.toHaveTransaction({
                success: false,
            });

            for (const user of [user1, user2]) {
                const userSharesWallet = blockchain.openContract(
                    JettonWallet.createFromAddress(
                        await pool.getSharesWalletAddress(user.address),
                    ),
                );

                const sharesBalance = await userSharesWallet.getJettonBalance();
                expect(sharesBalance).toBeGreaterThan(0n);

                const burnResult = await userSharesWallet.sendBurn(
                    user.getSender(),
                    await factory.getBurnLpFee(3),
                    sharesBalance,
                    user.address,
                    null,
                );

                expect(burnResult.transactions).not.toHaveTransaction({
                    success: false,
                });

                expect(burnResult.transactions).toHaveTransaction({
                    from: userSharesWallet.address,
                    to: pool.address,
                    op: Op.burn_notification,
                    success: true,
                });

                for (const vault of vaults) {
                    expect(burnResult.transactions).toHaveTransaction({
                        from: pool.address,
                        to: vault.address,
                        op: Op.payout,
                        success: true,
                    });
                }

                expect(burnResult.transactions).toHaveTransaction({
                    from: pool.address,
                    to: user.address,
                    op: Op.excesses,
                    success: true,
                });
            }

            const poolBalances = await pool.getBalances();
            expect(
                poolBalances.every((balance) => balance === 0n),
            ).toBeTruthy();
        });

        it.each([
            beginCell().storeUint(0xbaaaaaad, 64).endCell(),
            beginCell().storeUint(0xdeadbeef, 32).endCell(),
            beginCell().endCell(),
        ])(
            'should handle case when invalid custom_payload is sent on burn %s',
            async (invalidPayload) => {
                const assetConfig = [
                    {
                        ...DEFAULT_ASSET_PARAMETERS,
                        initialLiquidity: 100n,
                        tokenType: TokenType.Jetton,
                    },
                    {
                        ...DEFAULT_ASSET_PARAMETERS,
                        initialLiquidity: 100n,
                        tokenType: TokenType.Jetton,
                    },
                ];
                const { depositAllResult, pool, vaults, user, jettonMasters } =
                    await deployPoolTestingSetup({
                        factory,
                        assetConfig,
                        A: 200n,
                        adminFee: FEE_DENOMINATOR / 2n,
                        fee: 3000000n,
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

                const startingSharesBalance =
                    await usersSharesWallet.getJettonBalance();
                expect(startingSharesBalance).toBeGreaterThan(0n);

                const initialPoolBalances = await pool.getBalances();
                const invalidBurnResult = await usersSharesWallet.sendBurn(
                    user.getSender(),
                    await factory.getBurnLpFee(assetConfig.length),
                    startingSharesBalance,
                    user.address,
                    invalidPayload,
                );

                expect(invalidBurnResult.transactions).toHaveTransaction({
                    from: usersSharesWallet.address,
                    to: pool.address,
                    op: Op.burn_notification,
                    success: false,
                });

                for (const vault of vaults) {
                    expect(
                        invalidBurnResult.transactions,
                    ).not.toHaveTransaction({
                        from: pool.address,
                        to: vault.address,
                        op: Op.payout,
                        success: true,
                    });
                }

                const newSharesBalance =
                    await usersSharesWallet.getJettonBalance();
                expect(newSharesBalance).toBe(startingSharesBalance);

                const newPoolBalances = await pool.getBalances();
                expect(
                    newPoolBalances.every(
                        (balance, idx) => balance === initialPoolBalances[idx],
                    ),
                ).toBeTruthy();

                for (let i = 0; i < jettonMasters.length; i++) {
                    const jettonMaster = jettonMasters[i];
                    const userJettonWallet = blockchain.openContract(
                        await jettonMaster.getWallet(user.address),
                    );

                    expect(await userJettonWallet.getJettonBalance()).toBe(0n);
                }
            },
        );

        it.each(generateVariousLiquiditySetups(DEFAULT_LIQUIDITY))(
            'should be able to payout %s jettons to user in case of unsuccessful liquidity invest',
            async (_, { assetConfig }) => {
                const { depositAllResult, jettonMasters, vaults, pool, user } =
                    await deployPoolTestingSetup({
                        factory,
                        assetConfig,
                        A: 200n,
                        adminFee: 0n,
                        fee: 0n,
                    });

                const testJettonAmount = 42n;
                let lastResult: any;
                for (let jettonMaster of jettonMasters) {
                    await mintJettons(
                        jettonMaster,
                        user.address,
                        testJettonAmount,
                    );

                    const vaultAddress = await factory.getVaultAddress(
                        buildJettonToken(jettonMaster.address),
                    );

                    const vault = blockchain.openContract(
                        Vault.createFromAddress(vaultAddress),
                    );

                    const userJettonWallet = blockchain.openContract(
                        JettonWallet.createFromAddress(
                            await jettonMaster.getWalletAddress(user.address),
                        ),
                    );

                    const [addLiquidityJettonFee, addLiquidityFee] =
                        await factory.getAddLiquidityFee();

                    lastResult = await addJettonLiquidity(
                        vault,
                        userJettonWallet,
                        testJettonAmount,
                        pool,
                        user,
                        addLiquidityJettonFee,
                        addLiquidityFee,
                        jettonMasters.length,
                        10000000000000000000000000n,
                    );

                    expect(lastResult.transactions).not.toHaveTransaction({
                        success: false,
                    });
                }

                for (let vault of vaults) {
                    /*
                     * Check that pool will payout all deposited jettons back to user
                     */
                    expect(lastResult.transactions).toHaveTransaction({
                        from: pool.address,
                        to: vault.address,
                        op: Op.payout,
                    });

                    expect(lastResult.transactions).toHaveTransaction({
                        from: vault.address,
                        op: Op.transfer,
                    });

                    expect(lastResult.transactions).toHaveTransaction({
                        from: pool.address,
                        to: user.address,
                        op: Op.excesses,
                    });
                }

                for (let jettonMaster of jettonMasters) {
                    const userJettonWallet = blockchain.openContract(
                        JettonWallet.createFromAddress(
                            await jettonMaster.getWalletAddress(user.address),
                        ),
                    );

                    expect(await userJettonWallet.getJettonBalance()).toBe(
                        testJettonAmount,
                    );
                }
            },
        );
    });

    describe.each(generateVariousLiquiditySetups(DEFAULT_LIQUIDITY))(
        'Shares (Pool with %s tokens)',
        (_, { assetConfig }) => {
            it('should be able to mint shares equal to sum of tokens multiplied by token precision', async () => {
                const { depositAllResult, pool, user } =
                    await deployPoolTestingSetup({
                        factory,
                        assetConfig,
                        A: 200n,
                        adminFee: 0n,
                        fee: 0n,
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

                const sharesBalance =
                    await usersSharesWallet.getJettonBalance();
                const expectedSharesBalance = assetConfig.reduce(
                    (acc, asset) =>
                        asset.initialLiquidity * asset.precision + acc,
                    0n,
                );

                expect(sharesBalance).toBe(expectedSharesBalance);
            });

            it('should be able to burn minted shares back into initial liquidity', async () => {
                const { depositAllResult, pool, vaults, user, jettonMasters } =
                    await deployPoolTestingSetup({
                        factory,
                        assetConfig,
                        A: 200n,
                        adminFee: FEE_DENOMINATOR / 2n,
                        fee: 3000000n,
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

                const sharesBalance =
                    await usersSharesWallet.getJettonBalance();
                const expectedSharesBalance = assetConfig.reduce(
                    (acc, asset) =>
                        asset.initialLiquidity * asset.precision + acc,
                    0n,
                );

                expect(sharesBalance).toBe(expectedSharesBalance);

                const initialPoolBalances = await pool.getBalances();

                const burnResult = await usersSharesWallet.sendBurn(
                    user.getSender(),
                    await factory.getBurnLpFee(assetConfig.length),
                    sharesBalance,
                    null,
                    prepareRemoveLiquidityBalancedParameters(
                        initialPoolBalances,
                    ),
                );

                expect(burnResult.transactions).toHaveTransaction({
                    from: usersSharesWallet.address,
                    to: pool.address,
                    op: Op.burn_notification,
                    success: true,
                });

                for (const vault of vaults) {
                    expect(burnResult.transactions).toHaveTransaction({
                        from: pool.address,
                        to: vault.address,
                        op: Op.payout,
                        success: true,
                    });
                }

                expect(burnResult.transactions).toHaveTransaction({
                    from: pool.address,
                    to: user.address,
                    op: Op.excesses,
                    success: true,
                });

                expect(burnResult.transactions).not.toHaveTransaction({
                    success: false,
                });

                const newSharesBalance =
                    await usersSharesWallet.getJettonBalance();
                expect(newSharesBalance).toBe(0n);

                const newPoolBalances = await pool.getBalances();
                expect(
                    newPoolBalances.every((balance) => balance === 0n),
                ).toBeTruthy();

                for (let i = 0; i < jettonMasters.length; i++) {
                    const jettonMaster = jettonMasters[i];
                    const userJettonWallet = blockchain.openContract(
                        await jettonMaster.getWallet(user.address),
                    );

                    expect(await userJettonWallet.getJettonBalance()).toBe(
                        initialPoolBalances[i],
                    );
                }
            });

            it.each(assetConfig.map((_, i) => i).filter((_, idx) => idx % 2))(
                'should be able to burn minted shares into %sth coin in the pool',
                async (removeTokenIndex) => {
                    const {
                        depositAllResult,
                        pool,
                        vaults,
                        user,
                        jettonMasters,
                    } = await deployPoolTestingSetup({
                        factory,
                        assetConfig,
                        A: 200n,
                        adminFee: FEE_DENOMINATOR / 2n,
                        fee: 3000000n,
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

                    const sharesBalance =
                        await usersSharesWallet.getJettonBalance();
                    const expectedSharesBalance = assetConfig.reduce(
                        (acc, asset) =>
                            asset.initialLiquidity * asset.precision + acc,
                        0n,
                    );

                    expect(sharesBalance).toBe(expectedSharesBalance);

                    const estimatedWithdrawal = await pool.getWithdrawOneCoin(
                        sharesBalance,
                        0,
                    );

                    const poolBalances = await pool.getBalances();
                    const burnResult = await usersSharesWallet.sendBurn(
                        user.getSender(),
                        await factory.getBurnLpFee(assetConfig.length),
                        sharesBalance,
                        user.address,
                        prepareRemoveLiquidityOneCoinParameters(
                            removeTokenIndex,
                            poolBalances[removeTokenIndex] - 1n,
                        ),
                    );

                    expect(burnResult.transactions).toHaveTransaction({
                        from: usersSharesWallet.address,
                        to: pool.address,
                        op: Op.burn_notification,
                        success: true,
                    });

                    expect(burnResult.transactions).toHaveTransaction({
                        from: pool.address,
                        to: vaults[removeTokenIndex].address,
                        op: Op.payout,
                        success: true,
                    });

                    expect(burnResult.transactions).not.toHaveTransaction({
                        success: false,
                    });

                    const newSharesBalance =
                        await usersSharesWallet.getJettonBalance();
                    expect(newSharesBalance).toBe(0n);

                    const newPoolBalances = await pool.getBalances();
                    expect(newPoolBalances[removeTokenIndex]).toBe(1n);

                    const userRemovedJettonWallet = blockchain.openContract(
                        await jettonMasters[removeTokenIndex].getWallet(
                            user.address,
                        ),
                    );
                    const userRemovedJettonBalance =
                        await userRemovedJettonWallet.getJettonBalance();
                    expect(userRemovedJettonBalance).toBe(
                        poolBalances[removeTokenIndex] - 1n,
                    );
                    expect(userRemovedJettonBalance).toBe(estimatedWithdrawal);

                    /* Rest must be unchanged */
                    for (let i = 0; i < assetConfig.length; i++) {
                        if (i === removeTokenIndex) {
                            continue;
                        }

                        expect(poolBalances[i]).toBe(newPoolBalances[i]);
                    }
                },
            );
        },
    );
});
