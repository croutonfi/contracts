import { Cell, fromNano, toNano } from '@ton/core';
import { BlockchainTransaction } from '@ton/sandbox';
import { flattenTransaction, randomAddress } from '@ton/test-utils';
import {
    FactoryCode,
    JettonVaultCode,
    JettonWalletCode,
    LiquidityDepositCode,
    PoolCode,
    SharesWalletCode,
} from '../compilables';
import {
    calcAssetRateAndPrecision,
    deserealizeAssetsFromCell,
    JettonWallet,
    packFactoryConfigToCell,
    packJettonWalletConfigToCell,
    packLiquidityDepositConfigToCell,
    packPoolDeployConfigToCell,
    packVaultConfigToCell,
    prepareRemoveLiquidityBalancedParameters,
    prepareSwapParameters,
} from '../wrappers';
import { FEE_DENOMINATOR, Op, PoolConfig } from '../wrappers/constants';
import {
    buildJettonToken,
    buildNativeToken,
    readToken,
    TokenType,
} from '../wrappers/tokens';
import {
    collectCellStats,
    computeMsgStateInitFwdSizeStats,
    extractComputeGas,
} from '../wrappers/utils/gas';
import { deployFactory, factoryConfig } from './helpers/factory';
import { deployJettonMasters, mintJettons } from './helpers/jettons';
import { createLiquidityDeposit } from './helpers/liquidity_deposit';
import {
    createJettonAsset,
    deployPool,
    deployPoolTestingSetup,
} from './helpers/pools';
import { addJettonLiquidity, deployJettonVault } from './helpers/vaults';

const gasUsed: Record<string, bigint> = {};
const storageSizes: Record<
    string,
    {
        cells: number;
        bits: number;
    }
> = {};
const msgSizes: Record<
    string,
    {
        cells: number;
        bits: number;
    }
> = {};

const OpLabels = {
    // Jetton Wallet
    transfer: 'transfer',

    transfer_notification: 'transfer_notification',

    internal_transfer: 'internal_transfer',

    excesses: 'excesses',
    burn: 'burn',
    burn_notification: 'burn_notification',
    withdraw_tons: 'withdraw_tons',
    withdraw_jettons: 'withdraw_jettons',

    provide_wallet_address: 'provide_wallet_address',
    take_wallet_address: 'take_wallet_address',

    mint: 'mint',
    change_admin: 'change_admin',
    change_content: 'change_content',

    initialize: 'initialize',

    init_vault: 'init_vault',
    payout: 'payout',
    add_liquidity: 'add_liquidity',
    swap: 'swap',

    init_pool: 'init_pool',
    update_reserves: 'update_reserves',
    swap_notification: 'swap_notification',
    peer_swap: 'peer_swap',

    deploy_vault: 'deploy_vault',
    deploy_pool: 'deploy_pool',
    add_liquidity_notification: 'add_liquidity_notification',

    deposit_notification: 'deposit_notification',
    deposit_all: 'deposit_all',
    carry_remaining_balance: 'carry_remaining_balance',

    forward_msg: 'forward_msg',

    // custom for swap
    transfer_swap: 'transfer',
    transfer_notification_swap: 'transfer_notification',
    internal_transfer_swap: 'internal_transfer',

    //custom for liquidity_deposit
    transfer_add_liquidity: 'transfer',
    internal_transfer_add_liquidity: 'internal_transfer',
    transfer_notification_add_liquidity: 'transfer_notification',
    deploy_liquidity_deposit: 'initialize',

    //custom for pool
    mint_shares_internal_transfer: 'internal_transfer',

    burn_lp: 'burn',
    burn_lp_notification: 'burn_notification',
    payout_transfer: 'transfer',
    payout_internal_transfer: 'internal_transfer',
} as const satisfies Record<string, keyof typeof Op>;

function storeComputeGas(
    opLabel: keyof typeof OpLabels,
    tx: BlockchainTransaction | undefined,
) {
    if (tx == null) {
        throw new Error('no transaction to compute gas for op ' + opLabel);
    }

    const usedGas = extractComputeGas(tx);

    const opCode = flattenTransaction(tx).op!;
    const expectedOpCode = Op[OpLabels[opLabel]];

    if (opCode !== expectedOpCode) {
        throw new Error(
            'Op mismastched: ' +
                opLabel +
                `(${OpLabels[opLabel]}) with ` +
                Op.getOpByCode(opCode) +
                ' code ' +
                opCode.toString(16),
        );
    }

    if (gasUsed[opLabel] == null || gasUsed[opLabel] < usedGas) {
        gasUsed[opLabel] = usedGas;
    }
}

function logGas(opLabel: string): string | undefined {
    const used = gasUsed[opLabel];
    gasUsed[opLabel] = -1n;
    if (used >= 0n) {
        return '    const int gas::' + opLabel + ' = ' + used.toString() + ';';
    }
}

function logComputeGas(opLabels: string[]) {
    if (shouldLogComputeGas) {
        console.info(
            'Compute Gas:\n' +
                opLabels
                    .map(logGas)
                    .filter((el) => el != null)
                    .join('\n'),
        );
    }
}

function logUnknownGas() {
    if (shouldLogComputeGas) {
        for (const [key, value] of Object.entries(gasUsed)) {
            if (value >= 0n) {
                console.info('Unknown gas: ', key, value);
            }
        }
    }
}

function storeMsgSize(
    opLabel: keyof typeof OpLabels,
    tx: BlockchainTransaction | undefined,
) {
    if (tx == null) {
        throw new Error('no transaction to compute gas for op ' + opLabel);
    }

    if (!tx.inMessage) {
        throw new Error('no in message');
    }

    const opCode = flattenTransaction(tx).op!;
    const expectedOpCode = Op[OpLabels[opLabel]];

    if (opCode !== expectedOpCode) {
        throw new Error(
            'Op mismastched: ' +
                opLabel +
                `(${OpLabels[opLabel]}) with ` +
                Op.getOpByCode(opCode) +
                ' code ' +
                opCode.toString(16),
        );
    }

    let { stats: msgStats, visited } = computeMsgStateInitFwdSizeStats(
        tx.inMessage.init,
    );

    const bodyStats = collectCellStats(tx.inMessage.body, visited, false);

    msgStats = msgStats.add(bodyStats);

    if (
        msgSizes[opLabel] == null ||
        msgSizes[opLabel].cells < msgStats.cells ||
        msgSizes[opLabel].bits < msgStats.bits
    ) {
        msgSizes[opLabel] = {
            cells: Number(msgStats.cells),
            bits: Number(msgStats.bits),
        };
    }
}

function storeStorageSize(contract: string, state: Cell, extra: Cell[]) {
    const visited: string[] = [];

    let stats = collectCellStats(state, visited, true);

    // Add stats for extra cells
    for (const cell of extra) {
        stats = stats.add(collectCellStats(cell, visited, true));
    }

    if (
        storageSizes[contract] == null ||
        storageSizes[contract].cells < stats.cells ||
        storageSizes[contract].bits < stats.bits
    ) {
        storageSizes[contract] = {
            cells: Number(stats.cells),
            bits: Number(stats.bits),
        };
    }
}

function logApproximateStorageSize(contract: string): string | undefined {
    const storageSize = storageSizes[contract];
    if (storageSize && storageSize.cells >= 0) {
        return `    const int storage_cells::${contract} = ${storageSize.cells.toString()};\n    const int storage_bits::${contract} = ${(Math.ceil(storageSize.bits / 1023) * 1023).toString()};`;
    }
}
function logStorageSize(contract: string): string | undefined {
    const storageSize = storageSizes[contract];
    if (storageSize && storageSize.cells >= 0) {
        return `    const int storage_cells::${contract} = ${storageSize.cells.toString()};\n    const int storage_bits::${contract} = ${storageSize.bits.toString()};`;
    }
}

function logApproximateMsgSize(opLabel: string): string | undefined {
    const msgSize = msgSizes[opLabel];
    if (msgSize && msgSize.cells >= 0) {
        return `    const int msg_cells::${opLabel} = ${msgSize.cells.toString()};\n    const int msg_bits::${opLabel} = ${(Math.ceil(msgSize.bits / 1023) * 1023).toString()};`;
    }
}
function logMsgSize(opLabel: string): string | undefined {
    const msgSize = msgSizes[opLabel];
    if (msgSize && msgSize.cells >= 0) {
        return `    const int msg_cells::${opLabel} = ${msgSize.cells.toString()};\n    const int msg_bits::${opLabel} = ${msgSize.bits.toString()};`;
    }
}

function logMsgSizes(opLabels: string[]) {
    if (shouldLogMsgSize) {
        console.info(
            'Msg Size:\n' +
                opLabels
                    .map(logMsgSize)
                    .filter((el) => el != null)
                    .join('\n'),
        );
        console.info(
            'Approximate Msg Size:\n' +
                opLabels
                    .map(logApproximateMsgSize)
                    .filter((el) => el != null)
                    .join('\n\n'),
        );
    }
}

function logStorageSizes() {
    if (shouldLogStorageSize) {
        console.info(
            'Storage Size:\n' +
                Object.keys(storageSizes)
                    .map((key) => logStorageSize(key))
                    .filter((el) => el != null)
                    .join('\n'),
        );
        console.info(
            'Approximate Storage Size:\n' +
                Object.keys(storageSizes)
                    .map((key) => logApproximateStorageSize(key))
                    .filter((el) => el != null)
                    .join('\n\n'),
        );
    }
}

const ops = Object.keys(OpLabels);

const shouldLogComputeGas = process.env.LOG_GAS ?? false;
const shouldLogMsgSize = process.env.LOG_GAS ?? false;
const shouldLogStorageSize = process.env.LOG_GAS ?? false;

const increaseComputeGas = true;

describe('gas', () => {
    afterAll(() => {
        if (increaseComputeGas) {
            for (const [key, value] of Object.entries(gasUsed)) {
                // increasing gas used by 10%
                gasUsed[key] = BigInt(
                    Math.ceil((Number(value) * 1.1) / 1000) * 1000,
                );
            }
        }

        // per ops
        logComputeGas(ops);
        logUnknownGas();
        logMsgSizes(ops);

        // per contract
        logStorageSizes();
    });

    it('storage sizes', async () => {
        storeStorageSize(
            'jetton_wallet',
            packJettonWalletConfigToCell({
                balance: 100n,
                ownerAddress: randomAddress(),
                jettonMasterAddress: randomAddress(),
                jettonWalletCode: await JettonWalletCode,
            }),
            [await JettonWalletCode],
        );
        storeStorageSize(
            'factory',
            packFactoryConfigToCell(await factoryConfig(randomAddress())),
            [await FactoryCode],
        );
        storeStorageSize(
            'vault',
            packVaultConfigToCell({
                token: buildJettonToken(randomAddress()),

                factoryAddress: randomAddress(),
            }),
            [await JettonVaultCode],
        );
        storeStorageSize(
            'liquidity_deposit',
            packLiquidityDepositConfigToCell({
                factoryAddress: randomAddress(),
                ownerAddress: randomAddress(),
                poolAddress: randomAddress(),
            }),
            [await LiquidityDepositCode],
        );

        const jettonMasters = await blockchain.createWallets(3);

        // pool is inited later, so adding some refs manually here... wolo
        storeStorageSize(
            'pool',
            packPoolDeployConfigToCell({
                factoryAddress: randomAddress(),
                A: PoolConfig.default_A,
                assets: jettonMasters.map((jettonMaster) =>
                    createJettonAsset(jettonMaster),
                ),
            }),
            [await PoolCode, await SharesWalletCode, Cell.EMPTY],
        ); // empty cell for content, will need to set properly
    });

    it('report', async () => {
        const { factory } = await deployFactory();
        const [jettonSwapFee, swapFee] = await factory.getSwapFee();
        const [jettonAddLiquidityFee, addLiquidityFee] =
            await factory.getAddLiquidityFee();
        const depositAllFee = await factory.getDepositAllFee();
        const burnLpFee = await factory.getBurnLpFee(3);

        console.table([
            { op: 'swap', fee: fromNano(jettonSwapFee + swapFee) + ' TON' },
            {
                op: 'add_liquidity',
                fee: fromNano(jettonAddLiquidityFee + addLiquidityFee) + ' TON',
            },
            { op: 'deposit_all', fee: fromNano(depositAllFee) + ' TON' },
            { op: 'burn_lp', fee: fromNano(burnLpFee) + ' TON' },
        ]);
    });

    describe('chains of messages', () => {
        const DEFAULT_TOKEN_DECIMALS = 8;
        const DEFAULT_ASSET_PARAMETERS = {
            ...calcAssetRateAndPrecision(DEFAULT_TOKEN_DECIMALS),
            tokenType: TokenType.Jetton,
        };

        it('swap (single step)', async () => {
            const { factory } = await deployFactory();
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
            const initialUserBalance =
                await toJettonUserWallet.getJettonBalance();

            const fromJettonUserWallet = blockchain.openContract(
                await fromJetton.getWallet(user.address),
            );

            const fromJettonVaultWallet = blockchain.openContract(
                await fromJetton.getWallet(fromJettonVault.address),
            );

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

            const swapResult = await fromJettonUserWallet.sendTransfer(
                user.getSender(),
                toNano('1'),
                amountIn,
                fromJettonVault.address,
                user.address,
                Cell.EMPTY,
                toNano('0.5'),
                fwdPayload,
            );

            expect(swapResult.transactions).toHaveTransaction({
                from: fromJettonVault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });
            expect(swapResult.transactions).toHaveTransaction({
                from: pool.address,
                to: toJettonVault.address,
                op: Op.payout,
            });

            storeComputeGas('transfer_swap', swapResult.transactions[1]);
            storeComputeGas(
                'internal_transfer_swap',
                swapResult.transactions[2],
            );
            storeComputeGas(
                'transfer_notification_swap',
                swapResult.transactions[3],
            );
            storeComputeGas('excesses', swapResult.transactions[4]);
            storeComputeGas('swap_notification', swapResult.transactions[5]);
            storeComputeGas('payout', swapResult.transactions[6]);
            storeComputeGas('transfer', swapResult.transactions[7]);
            storeComputeGas('internal_transfer', swapResult.transactions[8]);
            storeComputeGas('excesses', swapResult.transactions[9]);

            storeMsgSize('transfer_swap', swapResult.transactions[1]);
            storeMsgSize('internal_transfer_swap', swapResult.transactions[2]);
            storeMsgSize(
                'transfer_notification_swap',
                swapResult.transactions[3],
            );
            storeMsgSize('excesses', swapResult.transactions[4]);
            storeMsgSize('swap_notification', swapResult.transactions[5]);
            storeMsgSize('payout', swapResult.transactions[6]);
            storeMsgSize('transfer', swapResult.transactions[7]);
            storeMsgSize('internal_transfer', swapResult.transactions[8]);
            storeMsgSize('excesses', swapResult.transactions[9]);
        });

        it('swap (two steps)', async () => {
            const { factory } = await deployFactory();
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
            const toJetton = jettonMasters2[1];

            const fromJettonVault = vaults[0];
            const toJettonVault = vaults2[1];

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

            const fromJettonVaultWallet = blockchain.openContract(
                await fromJetton.getWallet(fromJettonVault.address),
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
                        toToken: buildJettonToken(toJetton.address),
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

            const swapResult = await fromJettonUserWallet.sendTransfer(
                user.getSender(),
                toNano('1'),
                amountIn,
                fromJettonVault.address,
                user.address,
                Cell.EMPTY,
                toNano('0.5'),
                fwdPayload,
            );

            expect(swapResult.transactions).toHaveTransaction({
                from: fromJettonVault.address,
                to: pool.address,
                op: Op.swap_notification,
                success: true,
            });
            expect(swapResult.transactions).toHaveTransaction({
                from: pool2.address,
                to: toJettonVault.address,
                op: Op.payout,
            });

            storeComputeGas('transfer_swap', swapResult.transactions[1]);
            storeComputeGas(
                'internal_transfer_swap',
                swapResult.transactions[2],
            );
            storeComputeGas(
                'transfer_notification_swap',
                swapResult.transactions[3],
            );
            storeComputeGas('excesses', swapResult.transactions[4]);
            storeComputeGas('swap_notification', swapResult.transactions[5]);
            storeComputeGas('peer_swap', swapResult.transactions[6]);
            storeComputeGas('payout', swapResult.transactions[7]);
            storeComputeGas('transfer', swapResult.transactions[8]);
            storeComputeGas('internal_transfer', swapResult.transactions[9]);
            storeComputeGas('excesses', swapResult.transactions[10]);

            storeMsgSize('transfer_swap', swapResult.transactions[1]);
            storeMsgSize('internal_transfer_swap', swapResult.transactions[2]);
            storeMsgSize(
                'transfer_notification_swap',
                swapResult.transactions[3],
            );
            storeMsgSize('excesses', swapResult.transactions[4]);
            storeMsgSize('swap_notification', swapResult.transactions[5]);
            storeMsgSize('peer_swap', swapResult.transactions[6]);
            storeMsgSize('payout', swapResult.transactions[7]);
            storeMsgSize('transfer', swapResult.transactions[8]);
            storeMsgSize('internal_transfer', swapResult.transactions[9]);
            storeMsgSize('excesses', swapResult.transactions[10]);
        });

        it('liquidity deposit (3 tokens)', async () => {
            const { factory } = await deployFactory();
            const [jettonMaster, jettonMaster2, jettonMaster3] =
                await deployJettonMasters(3);

            const { vault } = await deployJettonVault(factory, jettonMaster);
            const { vault: vault2 } = await deployJettonVault(
                factory,
                jettonMaster2,
            );
            const { vault: vault3 } = await deployJettonVault(
                factory,
                jettonMaster3,
            );
            //
            const poolAssets = [jettonMaster, jettonMaster2, jettonMaster3].map(
                (contract) => createJettonAsset(contract),
            );
            const { pool } = await deployPool(factory, poolAssets);
            const user = await blockchain.treasury('user');
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
            expect(addLiquidityResult.transactions.length).toEqual(8);

            storeComputeGas(
                'transfer_add_liquidity',
                addLiquidityResult.transactions[1],
            );
            storeComputeGas(
                'internal_transfer_add_liquidity',
                addLiquidityResult.transactions[2],
            );
            storeComputeGas(
                'transfer_notification_add_liquidity',
                addLiquidityResult.transactions[3],
            );
            storeComputeGas('excesses', addLiquidityResult.transactions[4]);
            storeComputeGas(
                'add_liquidity_notification',
                addLiquidityResult.transactions[5],
            );

            storeComputeGas(
                'deploy_liquidity_deposit',
                addLiquidityResult.transactions[6],
            );
            storeComputeGas(
                'deposit_notification',
                addLiquidityResult.transactions[7],
            );

            storeMsgSize(
                'transfer_add_liquidity',
                addLiquidityResult.transactions[1],
            );
            storeMsgSize(
                'internal_transfer_add_liquidity',
                addLiquidityResult.transactions[2],
            );
            storeMsgSize(
                'transfer_notification_add_liquidity',
                addLiquidityResult.transactions[3],
            );
            storeMsgSize('excesses', addLiquidityResult.transactions[4]);
            storeMsgSize(
                'add_liquidity_notification',
                addLiquidityResult.transactions[5],
            );

            storeMsgSize(
                'deploy_liquidity_deposit',
                addLiquidityResult.transactions[6],
            );
            storeMsgSize(
                'deposit_notification',
                addLiquidityResult.transactions[7],
            );

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

            await mintJettons(jettonMaster3, user.address, amount);
            const wallet3 = blockchain.openContract(
                await jettonMaster3.getWallet(user.address),
            );
            expect(await wallet3.getJettonBalance()).toEqual(amount);

            const addLiquidity3Result = await addJettonLiquidity(
                vault3,
                wallet3,
                amount,
                pool,
                user,
            );
            expect(addLiquidity3Result.transactions).toHaveTransaction({
                from: vault3.address,
                to: factory.address,
                op: Op.add_liquidity_notification,
                success: true,
            });

            const liquidityDeposit = blockchain.openContract(
                await createLiquidityDeposit(factory, user, pool),
            );
            const [, , , , jettons, balances] =
                await liquidityDeposit.getLiquidityDepositData();

            expect(readToken(jettons).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(readToken(jettons).jettonMasterAddress).toEqualAddress(
                jettonMaster2.address,
            );
            expect(readToken(jettons).jettonMasterAddress).toEqualAddress(
                jettonMaster3.address,
            );

            expect(balances.readBigNumber()).toEqual(amount);
            expect(balances.readBigNumber()).toEqual(amount);
            expect(balances.readBigNumber()).toEqual(amount);

            const depositAllResult = await liquidityDeposit.sendDepositAll(
                user.getSender(),
            );
            expect(depositAllResult.transactions).toHaveTransaction({
                to: liquidityDeposit.address,
                op: Op.deposit_all,
                success: true,
                endStatus: 'non-existing',
            });

            storeComputeGas('deposit_all', depositAllResult.transactions[1]);
            storeComputeGas(
                'update_reserves',
                depositAllResult.transactions[2],
            );
            storeComputeGas(
                'mint_shares_internal_transfer',
                depositAllResult.transactions[3],
            );
            storeComputeGas('excesses', depositAllResult.transactions[4]);

            storeMsgSize('deposit_all', depositAllResult.transactions[1]);
            storeMsgSize('update_reserves', depositAllResult.transactions[2]);
            storeMsgSize(
                'mint_shares_internal_transfer',
                depositAllResult.transactions[3],
            );
            storeMsgSize('excesses', depositAllResult.transactions[4]);

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
            expect(sharesBalance).toBe(amount * 3n);

            const { assets: poolAssetsCell } = await pool.getPoolData();
            const poolNewAssets = deserealizeAssetsFromCell(poolAssetsCell);

            expect(poolNewAssets[0].token.jettonMasterAddress).toEqualAddress(
                poolAssets[0].token.jettonMasterAddress!,
            );
            expect(poolNewAssets[0].balance).toEqual(amount);

            expect(poolNewAssets[1].token.jettonMasterAddress).toEqualAddress(
                poolAssets[1].token.jettonMasterAddress!,
            );
            expect(poolNewAssets[1].balance).toEqual(amount);

            expect(poolNewAssets[2].token.jettonMasterAddress).toEqualAddress(
                poolAssets[2].token.jettonMasterAddress!,
            );
            expect(poolNewAssets[2].balance).toEqual(amount);
        });

        it('remove liquidity', async () => {
            const DEFAULT_LIQUIDITY = 9999n;

            const { factory } = await deployFactory();
            const assetConfig = [
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity: DEFAULT_LIQUIDITY,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity: DEFAULT_LIQUIDITY,
                },
                {
                    ...DEFAULT_ASSET_PARAMETERS,
                    initialLiquidity: DEFAULT_LIQUIDITY,
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

            const sharesBalance = await usersSharesWallet.getJettonBalance();
            const expectedSharesBalance = assetConfig.reduce(
                (acc, asset) => asset.initialLiquidity * asset.precision + acc,
                0n,
            );

            expect(sharesBalance).toBe(expectedSharesBalance);

            const initialPoolBalances = await pool.getBalances();

            const burnResult = await usersSharesWallet.sendBurn(
                user.getSender(),
                toNano(1),
                sharesBalance,
                user.address,
                prepareRemoveLiquidityBalancedParameters(initialPoolBalances),
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

            expect(burnResult.transactions).not.toHaveTransaction({
                success: false,
            });

            expect(burnResult.transactions.length).toEqual(16);

            storeComputeGas('burn_lp', burnResult.transactions[1]);
            storeComputeGas('burn_lp_notification', burnResult.transactions[2]);

            storeComputeGas('payout', burnResult.transactions[3]);
            storeComputeGas('payout', burnResult.transactions[4]);
            storeComputeGas('payout', burnResult.transactions[5]);

            storeComputeGas('excesses', burnResult.transactions[6]);

            storeComputeGas('payout_transfer', burnResult.transactions[7]);
            storeComputeGas('payout_transfer', burnResult.transactions[8]);
            storeComputeGas('payout_transfer', burnResult.transactions[9]);

            storeComputeGas(
                'payout_internal_transfer',
                burnResult.transactions[10],
            );
            storeComputeGas(
                'payout_internal_transfer',
                burnResult.transactions[11],
            );
            storeComputeGas(
                'payout_internal_transfer',
                burnResult.transactions[12],
            );

            storeComputeGas('excesses', burnResult.transactions[13]);
            storeComputeGas('excesses', burnResult.transactions[14]);
            storeComputeGas('excesses', burnResult.transactions[15]);

            storeMsgSize('burn_lp', burnResult.transactions[1]);
            storeMsgSize('burn_lp_notification', burnResult.transactions[2]);

            storeMsgSize('payout', burnResult.transactions[3]);
            storeMsgSize('payout', burnResult.transactions[4]);
            storeMsgSize('payout', burnResult.transactions[5]);

            storeMsgSize('excesses', burnResult.transactions[6]);

            storeMsgSize('payout_transfer', burnResult.transactions[7]);
            storeMsgSize('payout_transfer', burnResult.transactions[8]);
            storeMsgSize('payout_transfer', burnResult.transactions[9]);

            storeMsgSize(
                'payout_internal_transfer',
                burnResult.transactions[10],
            );
            storeMsgSize(
                'payout_internal_transfer',
                burnResult.transactions[11],
            );
            storeMsgSize(
                'payout_internal_transfer',
                burnResult.transactions[12],
            );

            storeMsgSize('excesses', burnResult.transactions[13]);
            storeMsgSize('excesses', burnResult.transactions[14]);
            storeMsgSize('excesses', burnResult.transactions[15]);

            const newSharesBalance = await usersSharesWallet.getJettonBalance();
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
    });
});
