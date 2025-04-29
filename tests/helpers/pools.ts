import { Address, Contract, toNano } from '@ton/core';
import { SandboxContract } from '@ton/sandbox';
import { BlankContractCode, PoolCode } from '../../compilables';
import { JettonMaster } from '../../wrappers';
import { Factory } from '../../wrappers/Factory';
import { Asset, Pool } from '../../wrappers/Pool';
import { Assets, Op, PoolConfig } from '../../wrappers/constants';
import {
    buildJettonToken,
    buildNativeToken,
    Token,
    TokenType,
} from '../../wrappers/tokens';
import { deployJettonMaster, mintJettons } from './jettons';
import { createLiquidityDeposit } from './liquidity_deposit';
import {
    addJettonLiquidity,
    addNativeLiquidity,
    deployJettonVault,
    deployNativeVault,
} from './vaults';

export type AssetConfig = {
    tokenType: TokenType;
    precision: bigint;
    rate: bigint;
    initialLiquidity: bigint;
    assetAddress?: Address;
}[];

export function createRates(length: number, rate = Assets.default_rate) {
    return Array(length).fill(rate);
}

export function createAsset(
    token: Token,
    precision: bigint = Assets.default_precicion,
): Asset {
    return {
        token,
        precision,
        balance: 0n,
        adminFees: 0n,
    };
}

export function createJettonAsset(
    jettonMaster: SandboxContract<Contract>,
    precision: bigint = Assets.default_precicion,
): Asset {
    return createAsset(buildJettonToken(jettonMaster.address), precision);
}

export function createNativeAsset(
    precision: bigint = Assets.default_precicion,
): Asset {
    return createAsset(buildNativeToken(), precision);
}

export async function deployPool(
    factory: SandboxContract<Factory>,
    assets: Asset[],
    rates: bigint[] = createRates(assets.length),
    A: bigint = PoolConfig.default_A,
    fee = 0n,
    adminFee = 0n,
    deployerSeed = 'deployer',
) {
    const deployer = await blockchain.treasury(deployerSeed);

    const result = await factory.sendDeployPool(
        deployer.getSender(),
        toNano('0.5'),
        assets,
        rates,
        A,
        fee,
        adminFee,
    );

    const pool = blockchain.openContract(
        Pool.createFromConfig(
            {
                factoryAddress: factory.address,
                assets,
                A,
            },
            await BlankContractCode,
            await PoolCode,
        ),
    );

    return {
        pool,
        result,
    };
}

export async function deployPoolTestingSetup(
    {
        factory,
        assetConfig,
        A,
        fee,
        adminFee,
    }: {
        factory: SandboxContract<Factory>;
        assetConfig: AssetConfig;
        A?: bigint;
        fee?: bigint;
        adminFee?: bigint;
    },
    deployerSeed = 'deployer',
) {
    // ensuring native is always last
    assetConfig = assetConfig.sort((a, b) => a.tokenType - b.tokenType);

    const deployer = await blockchain.treasury(deployerSeed);
    const jettonMasters: SandboxContract<JettonMaster>[] = [];
    const vaults = [];

    for (let i = 0; i < assetConfig.length; i++) {
        if (assetConfig[i].tokenType === TokenType.Jetton) {
            let jettonMaster: SandboxContract<JettonMaster>;
            if (typeof assetConfig[i].assetAddress !== 'undefined') {
                jettonMaster = blockchain.openContract(
                    await JettonMaster.createFromAddress(
                        assetConfig[i].assetAddress!,
                    ),
                );
            } else {
                jettonMaster = await deployJettonMaster();
            }
            jettonMasters.push(jettonMaster);
            const { vault } = await deployJettonVault(factory, jettonMaster);
            vaults.push(vault);
        } else {
            const { vault } = await deployNativeVault(factory);
            vaults.push(vault);
        }
    }

    const poolAssets = assetConfig.map((assetConfig, idx) => {
        const token =
            assetConfig.tokenType === TokenType.Jetton
                ? buildJettonToken(jettonMasters[idx].address)
                : buildNativeToken();

        return createAsset(token, assetConfig.precision);
    });

    const rates = assetConfig.map(({ rate }) => rate);
    const { pool, result: poolDeploymentResult } = await deployPool(
        factory,
        poolAssets,
        rates,
        A,
        fee,
        adminFee,
    );

    expect(poolDeploymentResult.transactions).toHaveTransaction({
        from: pool.address,
        to: pool.address,
        op: Op.init_pool,
        success: true,
    });

    const user = await blockchain.treasury('user');

    const [jettonAddLiquidityFee, vaultAddLiquidityFee] =
        await factory.getAddLiquidityFee();

    for (let i = 0; i < assetConfig.length; i++) {
        const amount = assetConfig[i].initialLiquidity;
        const vault = vaults[i];

        if (assetConfig[i].tokenType === TokenType.Jetton) {
            const jettonMaster = jettonMasters[i];

            await mintJettons(jettonMaster, user.address, amount);

            const wallet = blockchain.openContract(
                await jettonMaster.getWallet(user.address),
            );

            await addJettonLiquidity(
                vault,
                wallet,
                amount,
                pool,
                user,
                jettonAddLiquidityFee,
                vaultAddLiquidityFee,
            );
        } else {
            await addNativeLiquidity(
                vault,
                amount,
                pool,
                user,
                vaultAddLiquidityFee,
            );
        }
    }

    const liquidityDeposit = blockchain.openContract(
        await createLiquidityDeposit(factory, user, pool),
    );

    const depositAllFee = await factory.getDepositAllFee();
    const depositAllResult = await liquidityDeposit.sendDepositAll(
        user.getSender(),
        depositAllFee,
    );

    return {
        pool,
        jettonMasters,
        vaults,
        user,
        liquidityDeposit,
        deployer,
        depositAllResult,
    };
}
