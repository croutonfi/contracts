import { beginCell, Cell } from '@ton/core';
import { SandboxContract } from '@ton/sandbox';
import '@ton/test-utils';
import { FEE_DENOMINATOR, Op } from '../wrappers/constants';
import { Factory } from '../wrappers/Factory';
import {
    calcAssetRateAndPrecision,
    prepareNativeSwapParameters,
    prepareSwapParameters,
} from '../wrappers/Pool';
import {
    buildJettonToken,
    buildNativeToken,
    TokenType,
} from '../wrappers/tokens';
import { deployFactory } from './helpers/factory';
import { mintJettons } from './helpers/jettons';
import { deployPoolTestingSetup } from './helpers/pools';
import { expectNativePayoutTxValue } from './helpers/vaults';

const DEFAULT_TOKEN_DECIMALS = 8;
const DEFAULT_ASSET_PARAMETERS = {
    ...calcAssetRateAndPrecision(DEFAULT_TOKEN_DECIMALS),
    tokenType: TokenType.Jetton,
};

describe('Swaps', () => {
    let factory: SandboxContract<Factory>;

    beforeAll(async () => {
        let { factory: deployedFactory, result } = await deployFactory();

        factory = deployedFactory;

        expect(result.transactions).toHaveTransaction({
            to: factory.address,
            deploy: true,
            success: true,
        });
    });

    it('should be able to deploy Pool with deposited liquidity, and then swap two assets', async () => {
        const initialLiquidity = 10000000n;

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
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];
        const toJetton = jettonMasters[1];

        const fromJettonVault = vaults[0];
        const toJettonVault = vaults[1];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const successPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

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
                successPayload,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            (swapFee + swapJettonFee) * 2n,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee * 2n,
            fwdPayload,
        );
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

        const toJettonVaultWallet = await toJetton.getWallet(
            toJettonVault.address,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: toJettonVault.address,
            to: toJettonVaultWallet.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toJettonVaultWallet.address,
            to: toJettonUserWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toJettonUserWallet.address,
            to: user.address,
            op: Op.transfer_notification,
            success: true,
            body: beginCell()
                .storeUint(Op.transfer_notification, 32)
                .storeUint(0, 64)
                .storeCoins(estimatedAmountOut)
                .storeAddress(toJettonVault.address)
                .storeMaybeRef(successPayload)
                .endCell(),
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        const newUserBalance = await toJettonUserWallet.getJettonBalance();

        expect(newUserBalance).toEqual(initialUserBalance + estimatedAmountOut);
        expect(newUserBalance > initialUserBalance).toBeTruthy();
    });

    it('should return funds to user if limit is reached', async () => {
        const initialLiquidity = 10000000n;

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
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];
        const toJetton = jettonMasters[1];

        const fromJettonVault = vaults[0];
        const toJettonVault = vaults[1];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );
        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );
        const fromJettonVaultWallet = await fromJetton.getWallet(
            fromJettonVault.address,
        );
        const initialUserBalance =
            await fromJettonUserWallet.getJettonBalance();

        const failPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(toJetton.address),
                    limit: estimatedAmountOut + 1n,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: null,
                failPayload,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );
        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: fromJettonVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: fromJettonVaultWallet.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVaultWallet.address,
            to: fromJettonUserWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonUserWallet.address,
            to: user.address,
            op: Op.transfer_notification,
            success: true,
            body: beginCell()
                .storeUint(Op.transfer_notification, 32)
                .storeUint(0, 64)
                .storeCoins(amountIn)
                .storeAddress(fromJettonVault.address)
                .storeMaybeRef(failPayload)
                .endCell(),
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expect(await fromJettonUserWallet.getJettonBalance()).toEqual(
            initialUserBalance,
        );
    });

    it('should be able to deploy Pool with deposited liquidity, and then swap jetton into native asset', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];

        const fromJettonVault = vaults[0];
        const toNativeVault = vaults[2];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildNativeToken(),
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

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: toNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toNativeVault.address,
            to: user.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expectNativePayoutTxValue(transferResult, estimatedAmountOut);
    });

    it('should be able to deploy 2 pools with deposited liquidity, and then swap jetton into native asset, then native asset to jetton', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const {
            jettonMasters: jettonMasters2,
            vaults: vaults2,
            pool: pool2,
        } = await deployPoolTestingSetup({
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
                    tokenType: TokenType.Native,
                },
            ],
            A: 200n,
            adminFee: 0n,
            fee: 0n,
        });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;
        const estimatedAmountOut2 = 997n; // should be less than estimatedAmountOut by 1;

        const fromJetton = jettonMasters[0];
        const fromJettonVault = vaults[0];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const finnalJetton = jettonMasters2[0];
        const finnalJettonVault = vaults2[0];

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );
        const finnalJettonUserWallet = blockchain.openContract(
            await finnalJetton.getWallet(user.address),
        );
        const finnalJettonVaultWallet = blockchain.openContract(
            await finnalJetton.getWallet(finnalJettonVault.address),
        );

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildNativeToken(),
                    limit: estimatedAmountOut,
                },
                {
                    pool: pool2.address,
                    toToken: buildJettonToken(finnalJetton.address),
                    limit: estimatedAmountOut2,
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
        const initialUserBalance =
            await finnalJettonUserWallet.getJettonBalance();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });
        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: pool2.address,
            op: Op.peer_swap,
            success: true,
        });
        expect(transferResult.transactions).toHaveTransaction({
            from: pool2.address,
            to: finnalJettonVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: finnalJettonVault.address,
            to: finnalJettonVaultWallet.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: finnalJettonVaultWallet.address,
            to: finnalJettonUserWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });
        expect(await finnalJettonUserWallet.getJettonBalance()).toEqual(
            initialUserBalance + estimatedAmountOut2,
        );
    });

    it('should be able to deploy 2 pools with deposited liquidity, and then swap jetton into jetton, then jetton to native asset', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const toJetton = jettonMasters[1];

        const { vaults: vaults2, pool: pool2 } = await deployPoolTestingSetup({
            factory,
            assetConfig: [
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    assetAddress: toJetton.address,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    tokenType: TokenType.Native,
                },
            ],
            A: 200n,
            adminFee: 0n,
            fee: 0n,
        });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;
        const estimatedAmountOut2 = 997n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];
        const fromJettonVault = vaults[0];

        const toNativeVault = vaults2[2];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(toJetton.address),
                    limit: estimatedAmountOut,
                },
                {
                    pool: pool2.address,
                    toToken: buildNativeToken(),
                    limit: estimatedAmountOut2,
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

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });
        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: pool2.address,
            op: Op.peer_swap,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool2.address,
            to: toNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toNativeVault.address,
            to: user.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expectNativePayoutTxValue(transferResult, estimatedAmountOut2);
    });

    it('should be able to deploy 2 pools with deposited liquidity, and then swap jetton into jetton, then jetton to native asset with successPayload', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const toJetton = jettonMasters[1];

        const { vaults: vaults2, pool: pool2 } = await deployPoolTestingSetup({
            factory,
            assetConfig: [
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    assetAddress: toJetton.address,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    tokenType: TokenType.Native,
                },
            ],
            A: 200n,
            adminFee: 0n,
            fee: 0n,
        });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;
        const estimatedAmountOut2 = 997n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];
        const fromJettonVault = vaults[0];

        const toNativeVault = vaults2[2];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const successPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(toJetton.address),
                    limit: estimatedAmountOut,
                },
                {
                    pool: pool2.address,
                    toToken: buildNativeToken(),
                    limit: estimatedAmountOut2,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: successPayload,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });
        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: pool2.address,
            op: Op.peer_swap,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool2.address,
            to: toNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toNativeVault.address,
            to: user.address,
            op: 42,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expectNativePayoutTxValue(transferResult, estimatedAmountOut2);
    });

    it('should be able to deploy 2 pools with deposited liquidity, and then swap jetton into jetton, then fail swap jetton to native asset if limit reached with failPayload', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const middleJetton = jettonMasters[1];
        const middleJettonVault = vaults[1];

        const { pool: pool2 } = await deployPoolTestingSetup({
            factory,
            assetConfig: [
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    assetAddress: middleJetton.address,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity,
                    tokenType: TokenType.Native,
                },
            ],
            A: 200n,
            adminFee: 0n,
            fee: 0n,
        });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;
        const estimatedAmountOut2 = 999n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];
        const fromJettonVault = vaults[0];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );
        const middleJettonUserWallet = blockchain.openContract(
            await middleJetton.getWallet(user.address),
        );
        const middleJettonVaultWallet = blockchain.openContract(
            await middleJetton.getWallet(middleJettonVault.address),
        );

        const failPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(middleJetton.address),
                    limit: estimatedAmountOut,
                },
                {
                    pool: pool2.address,
                    toToken: buildNativeToken(),
                    limit: estimatedAmountOut2,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: null,
                failPayload: failPayload,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();
        const initialUserBalance =
            await middleJettonUserWallet.getJettonBalance();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });
        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: pool2.address,
            op: Op.peer_swap,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool2.address,
            to: middleJettonVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: middleJettonVault.address,
            to: middleJettonVaultWallet.address,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: middleJettonVaultWallet.address,
            to: middleJettonUserWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });
        expect(await middleJettonUserWallet.getJettonBalance()).toEqual(
            initialUserBalance + estimatedAmountOut,
        );
    });

    it('should be able to deploy Pool with deposited liquidity, and then swap jetton into native asset with successPayload', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const fromJetton = jettonMasters[0];

        const fromJettonVault = vaults[0];
        const toNativeVault = vaults[2];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const successPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildNativeToken(),
                    limit: estimatedAmountOut,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();

        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: toNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: toNativeVault.address,
            to: user.address,
            op: 42,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expectNativePayoutTxValue(transferResult, estimatedAmountOut);
    });

    it('should deploy a pool with native asset and perform a swap from native asset', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const toJettonMaster = jettonMasters[0];
        const toJettonVault = vaults[0];

        const fromNativeVault = vaults[2];
        const toJettonUserWallet = blockchain.openContract(
            await toJettonMaster.getWallet(user.address),
        );
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

        const fwdPayload = prepareNativeSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(toJettonMaster.address),
                    limit: estimatedAmountOut,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: null,
                failPayload: null,
            },
            0,
            amountIn,
        );

        const [_, swapFee] = await factory.getSwapFee();

        const transferResult = await fromNativeVault.sendMessage(
            user.getSender(),
            fwdPayload,
            swapFee + amountIn,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromNativeVault.address,
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

        const vaultToJettonWallet = await toJettonMaster.getWalletAddress(
            toJettonVault.address,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: toJettonVault.address,
            to: vaultToJettonWallet,
            op: Op.transfer,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: vaultToJettonWallet,
            to: toJettonUserWallet.address,
            op: Op.internal_transfer,
            success: true,
        });

        expect(await toJettonUserWallet.getJettonBalance()).toEqual(
            initialUserBalance + estimatedAmountOut,
        );
    });

    it('should return native asset to user if limit is reached with failPayload', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const toJettonMaster = jettonMasters[0];
        const toJettonVault = vaults[0];

        const fromNativeVault = vaults[2];
        const toJettonUserWallet = blockchain.openContract(
            await toJettonMaster.getWallet(user.address),
        );
        const initialUserBalance = await user.getBalance();

        const failPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const fwdPayload = prepareNativeSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(toJettonMaster.address),
                    limit: estimatedAmountOut + 1n,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: null,
                failPayload,
            },
            0,
            amountIn,
        );

        const [_, swapFee] = await factory.getSwapFee();

        const transferResult = await fromNativeVault.sendMessage(
            user.getSender(),
            fwdPayload,
            swapFee + amountIn,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromNativeVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: fromNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: fromNativeVault.address,
            to: user.address,
            op: 42,
            success: true,
        });

        expectNativePayoutTxValue(transferResult, amountIn);
    });

    it('should return native asset if asset not found in the pool with failPayload', async () => {
        const initialLiquidity = 10000000n;

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
                        tokenType: TokenType.Native,
                    },
                ],
                A: 200n,
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = 999n;
        const estimatedAmountOut = 998n; // should be less than amountIn by 1;

        const toJettonMaster = jettonMasters[0];
        const toJettonVault = vaults[0];

        const fromNativeVault = vaults[2];
        const toJettonUserWallet = blockchain.openContract(
            await toJettonMaster.getWallet(user.address),
        );
        const initialUserBalance = await user.getBalance();

        const failPayload = beginCell()
            .storeUint(42, 32)
            .storeUint(0, 64)
            .endCell();

        const wrongTokenAddress = toJettonVault.address;

        const fwdPayload = prepareNativeSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(wrongTokenAddress),
                    limit: estimatedAmountOut,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 100000,
                successPayload: null,
                failPayload,
            },
            0,
            amountIn,
        );

        const [_, swapFee] = await factory.getSwapFee();

        const transferResult = await fromNativeVault.sendMessage(
            user.getSender(),
            fwdPayload,
            swapFee + amountIn,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromNativeVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: fromNativeVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: fromNativeVault.address,
            to: user.address,
            op: 42,
            success: true,
        });

        expectNativePayoutTxValue(transferResult, amountIn);
    });

    it('should predictably estimate swap using get_y method', async () => {
        const initialLiquidity = 10000000n;
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
                adminFee: 0n,
                fee: 0n,
            });

        const amountIn = initialLiquidity;

        const fromJetton = jettonMasters[0];
        const toJetton = jettonMasters[1];

        const fromJettonVault = vaults[0];
        const toJettonVault = vaults[1];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

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
        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

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

        const newUserBalance = await toJettonUserWallet.getJettonBalance();

        expect(newUserBalance).toEqual(initialUserBalance + estimatedAmountOut);
        expect(newUserBalance > initialUserBalance).toBeTruthy();
    });

    it("should predictably swap enormous amounts of coins and don't allow to fully drain the last coin", async () => {
        const initialLiquidity = 100000n;
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
                adminFee: 0n,
                fee: 0n,
            });

        const swapsToMake = 3;
        const amountIn = initialLiquidity ** 5n;

        const fromJetton = jettonMasters[0];
        const toJetton = jettonMasters[1];

        const fromJettonVault = vaults[0];
        const toJettonVault = vaults[1];

        // mint some jettons to user
        await mintJettons(
            fromJetton,
            user.address,
            amountIn * BigInt(swapsToMake),
        );

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        for (let i = 0; i < swapsToMake; i++) {
            const fwdPayload = prepareSwapParameters(
                [
                    {
                        pool: pool.address,
                        toToken: buildJettonToken(toJetton.address),
                        limit: 1n,
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
            const transferResult = await fromJettonUserWallet.sendTransfer(
                user.getSender(),
                swapFee + swapJettonFee,
                amountIn,
                fromJettonVault.address,
                user.address,
                Cell.EMPTY,
                swapFee,
                fwdPayload,
            );

            expect(transferResult.transactions).toHaveTransaction({
                from: fromJettonVault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });

            if (i === 0) {
                expect(transferResult.transactions).toHaveTransaction({
                    from: pool.address,
                    to: toJettonVault.address,
                    op: Op.payout,
                    success: true,
                });
            }

            expect(transferResult.transactions).not.toHaveTransaction({
                success: false,
            });

            if (i > 0) {
                const newUserBalance =
                    await toJettonUserWallet.getJettonBalance();

                expect(newUserBalance).toEqual(initialLiquidity - 1n);

                const [reserve0, reserve1] = await pool.getBalances();

                expect(reserve0).toEqual(initialLiquidity + amountIn);
                expect(reserve1).toEqual(1n);
            }
        }
    });

    it('should be able to account for fees in swap', async () => {
        const initialLiquidity = 1_000_000_000n;
        const feeRaw = 0.003; // 0.3%
        const fee = BigInt(Math.floor(feeRaw * Number(FEE_DENOMINATOR)));

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
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

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
        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

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

        const newUserBalance = await toJettonUserWallet.getJettonBalance();

        expect(newUserBalance).toEqual(initialUserBalance + estimatedAmountOut);
        expect(newUserBalance > initialUserBalance).toBeTruthy();

        const adminFeeBalances = await pool.getAdminFeeBalances();

        /**
         * It's a balanced pool, so we expect estimated output as amountIn - fee - 1
         * Therefore admin fee should be (amountIn * fee * adminFee) / FEE_DENOMINATOR ** 2 - 1
         */
        expect(adminFeeBalances[1]).toEqual(
            (amountIn * fee * adminFee) / FEE_DENOMINATOR ** 2n - 1n,
        );
    });

    it('should be able to swap in pool with different precisions', async () => {
        const initialLiquidity = 1_000_000n;
        const feeRaw = 0.003; // 0.3%
        const fee = BigInt(Math.floor(feeRaw * Number(FEE_DENOMINATOR)));

        const adminFee = FEE_DENOMINATOR / 2n; // half of fees go to admin

        const [asset1, asset2, asset3] = [
            calcAssetRateAndPrecision(8, 1),
            calcAssetRateAndPrecision(9, 1),
            calcAssetRateAndPrecision(13, 1),
        ];

        const { user, jettonMasters, vaults, pool } =
            await deployPoolTestingSetup({
                factory,
                assetConfig: [
                    {
                        ...asset1,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset1.one,
                    },
                    {
                        ...asset2,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset2.one,
                    },
                    {
                        ...asset3,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset3.one,
                    },
                ],
                A: 200n,
                adminFee,
                fee,
            });

        const amountIn = 10_000n * asset1.one;

        const fromJetton = jettonMasters[0];
        const toJetton = jettonMasters[1];

        const fromJettonVault = vaults[0];
        const toJettonVault = vaults[1];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

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
                deadline: Math.floor(Date.now() / 1000) + 1000,
                successPayload: null,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();
        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapJettonFee + swapFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

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

        const newUserBalance = await toJettonUserWallet.getJettonBalance();

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        expect(newUserBalance).toEqual(initialUserBalance + estimatedAmountOut);
        expect(newUserBalance > initialUserBalance).toBeTruthy();

        const amountOutWithDecimals = newUserBalance / asset2.one;

        expect(
            amountOutWithDecimals >= 9_969n && amountOutWithDecimals <= 9_970n,
        ).toBeTruthy();
    });

    it('should properly handle a case when from_token == to_token', async () => {
        const initialLiquidity = 1_000_000n;
        const feeRaw = 0.003; // 0.3%
        const fee = BigInt(Math.floor(feeRaw * Number(FEE_DENOMINATOR)));

        const adminFee = FEE_DENOMINATOR / 2n; // half of fees go to admin

        const [asset1, asset2, asset3] = [
            calcAssetRateAndPrecision(8, 1),
            calcAssetRateAndPrecision(9, 1),
            calcAssetRateAndPrecision(13, 1),
        ];

        const { user, jettonMasters, vaults, pool } =
            await deployPoolTestingSetup({
                factory,
                assetConfig: [
                    {
                        ...asset1,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset1.one,
                    },
                    {
                        ...asset2,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset2.one,
                    },
                    {
                        ...asset3,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset3.one,
                    },
                ],
                A: 200n,
                adminFee,
                fee,
            });

        const amountIn = 10_000n * asset1.one;

        const fromJetton = jettonMasters[0];
        const fromJettonVault = vaults[0];

        await mintJettons(fromJetton, user.address, amountIn);

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const startingUserBalance =
            await fromJettonUserWallet.getJettonBalance();

        const fwdPayload = prepareSwapParameters(
            [
                {
                    pool: pool.address,
                    toToken: buildJettonToken(fromJetton.address),
                    limit: 0n,
                },
            ],
            {
                recipient: user.address,
                deadline: Math.floor(Date.now() / 1000) + 1000,
                successPayload: null,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();
        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapJettonFee + swapFee,
            1000n,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

        expect(transferResult.transactions).toHaveTransaction({
            from: fromJettonVault.address,
            to: pool.address,
            op: Op.swap_notification,
            success: true,
        });

        expect(transferResult.transactions).toHaveTransaction({
            from: pool.address,
            to: fromJettonVault.address,
            op: Op.payout,
            success: true,
        });

        expect(transferResult.transactions).not.toHaveTransaction({
            success: false,
        });

        const newUserBalance = await fromJettonUserWallet.getJettonBalance();

        expect(newUserBalance).toEqual(startingUserBalance);
    });

    it('should be able to swap in pool with imbalanced reserves (1000:1)', async () => {
        const initialLiquidity = 1_000_000n;
        const feeRaw = 0.003;
        const fee = BigInt(Math.floor(feeRaw * Number(FEE_DENOMINATOR)));
        const adminFee = FEE_DENOMINATOR / 2n;

        const [asset1, asset2] = [
            calcAssetRateAndPrecision(0, 1),
            calcAssetRateAndPrecision(0, 1),
        ];

        const { user, jettonMasters, vaults, pool } =
            await deployPoolTestingSetup({
                factory,
                assetConfig: [
                    {
                        ...asset1,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * 1000n * asset1.one,
                    },
                    {
                        ...asset2,
                        tokenType: TokenType.Jetton,
                        initialLiquidity: initialLiquidity * asset2.one,
                    },
                ],
                A: 1000n,
                adminFee,
                fee,
            });

        const amountIn = initialLiquidity * asset1.one;

        const fromJettonIdx = 0;
        const toJettonIdx = 1;

        const fromJetton = jettonMasters[fromJettonIdx];
        const fromJettonVault = vaults[fromJettonIdx];
        const toJetton = jettonMasters[toJettonIdx];
        const toJettonVault = vaults[toJettonIdx];

        // mint some jettons to user
        await mintJettons(fromJetton, user.address, amountIn);

        const toJettonUserWallet = blockchain.openContract(
            await toJetton.getWallet(user.address),
        );
        const initialUserBalance = await toJettonUserWallet.getJettonBalance();

        const fromJettonUserWallet = blockchain.openContract(
            await fromJetton.getWallet(user.address),
        );

        const estimatedAmountOut = await pool.getDy(
            fromJettonIdx,
            toJettonIdx,
            amountIn,
        );

        expect(estimatedAmountOut).toBeLessThan(amountIn);

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
                deadline: Math.floor(Date.now() / 1000) + 1000,
                successPayload: null,
                failPayload: null,
            },
        );

        const [swapJettonFee, swapFee] = await factory.getSwapFee();
        const transferResult = await fromJettonUserWallet.sendTransfer(
            user.getSender(),
            swapFee + swapJettonFee,
            amountIn,
            fromJettonVault.address,
            user.address,
            Cell.EMPTY,
            swapFee,
            fwdPayload,
        );

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

        const newUserBalance = await toJettonUserWallet.getJettonBalance();

        expect(newUserBalance).toEqual(initialUserBalance + estimatedAmountOut);
        expect(newUserBalance > initialUserBalance).toBeTruthy();

        const amountOutWithDecimals = newUserBalance / asset2.one;
        const expectedValueFromPythonModel = 11412n;

        expect(
            amountOutWithDecimals >= expectedValueFromPythonModel - 1n &&
                amountOutWithDecimals <= expectedValueFromPythonModel,
        ).toBeTruthy();
    });
});
