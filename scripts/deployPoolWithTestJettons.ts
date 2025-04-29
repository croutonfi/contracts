import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { BlankContractCode, PoolCode } from '../compilables';
import {
    Asset,
    calcAssetRateAndPrecision,
    Factory,
    packPoolDeployConfigToCell,
    Pool,
} from '../wrappers';
import { FEE_DENOMINATOR } from '../wrappers/constants';
import { buildJettonToken, buildNativeToken } from '../wrappers/tokens';
import {
    createDeployStateIfNotExists,
    DeployState,
    matchDeployFiles,
    saveDeployState,
} from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const allFactoryDeployments = matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to deploy Vault',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const shouldContainNativePool = await ui.prompt(
        'Should the pool contain native token? (y/n):',
    );

    const numberOfJettons = Number(
        await ui.input(
            'Ok. Now enter desired number of TestJettons in the pool:',
        ),
    );
    if (numberOfJettons < 2 || numberOfJettons > 8) {
        throw new Error('Number of TestJettons should be between 2 and 8');
    }

    const allTestJettonDeployments = matchDeployFiles('testJetton');
    const selectedJettonDeployments: DeployState[] = [];
    for (let i = 0; i < numberOfJettons; i++) {
        const availableJettonDeployments = allTestJettonDeployments.filter(
            ([, deployment]) =>
                selectedJettonDeployments.indexOf(deployment) === -1,
        );

        if (availableJettonDeployments.length === 0) {
            throw new Error(
                'Not enough TestJettons to choose from. Please deploy more TestJettons first.',
            );
        }

        const [, testJettonDeployment] = await ui.choose(
            `Choose #${i + 1} TestJetton to include in the new pool`,
            availableJettonDeployments,
            ([filename, { meta }]) => {
                const parsedMeta = JSON.parse(meta);
                return `${filename} ${parsedMeta.name} ${parsedMeta.symbol} (${parsedMeta.decimals})`;
            },
        );

        selectedJettonDeployments.push(testJettonDeployment);
    }

    const A = BigInt(
        (await ui.input(
            'Enter the A parameter for the new pool (default=200):',
        )) || '200',
    );
    const fee = BigInt(
        (await ui.input(
            'Enter the fee parameter for the new pool (default=30000000):',
        )) || '30000000',
    );
    const adminFee = BigInt(
        (await ui.input(
            'Enter the admin fee parameter for the new pool (default=5000000000):',
        )) || FEE_DENOMINATOR / 2n,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    ui.setActionPrompt(`Deploying Pool with specified parameters...`);

    const assets: Asset[] = selectedJettonDeployments.map(
        (jettonDeployment) => {
            return {
                adminFees: 0n,
                balance: 0n,
                token: buildJettonToken(
                    Address.parse(jettonDeployment.address),
                ),
                ...calcAssetRateAndPrecision(
                    BigInt(JSON.parse(jettonDeployment.meta).decimals),
                ),
            };
        },
    );
    const rates = selectedJettonDeployments.map(
        (jettonDeployment) =>
            calcAssetRateAndPrecision(
                BigInt(JSON.parse(jettonDeployment.meta).decimals),
            ).rate,
    );

    if (shouldContainNativePool) {
        assets.unshift({
            adminFees: 0n,
            balance: 0n,
            token: buildNativeToken(),
            ...calcAssetRateAndPrecision(9n),
        });

        rates.unshift(calcAssetRateAndPrecision(9n).rate);
    }

    const poolConfig = {
        factoryAddress: factory.address,
        assets,
        A,
    };
    const pool = provider.open(
        Pool.createFromConfig(
            poolConfig,
            await BlankContractCode,
            await PoolCode,
        ),
    );

    if (await provider.isContractDeployed(pool.address)) {
        ui.write(
            `Error: Contract at address ${pool.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'pool',
            pool.address.toString(),
            await BlankContractCode,
            packPoolDeployConfigToCell(poolConfig),
            JSON.stringify({
                assets: assets.map((asset) => [
                    asset.token.jettonMasterAddress?.toString() || 'NATIVE_TON',
                    asset.precision.toString(),
                ]),
                rates: rates.map((rate) => rate.toString()),
            }),
        );
        return;
    }

    await factory.sendDeployPool(
        provider.sender(),
        toNano('0.1'),
        assets,
        rates,
        A,
        fee,
        adminFee,
    );

    await provider.waitForDeploy(pool.address, 20);

    saveDeployState(
        'pool',
        pool.address.toString(),
        await BlankContractCode,
        packPoolDeployConfigToCell(poolConfig),
        JSON.stringify({
            assets: assets.map((asset) => [
                asset.token.jettonMasterAddress?.toString() || 'NATIVE_TON',
                asset.precision.toString(),
            ]),
            rates: rates.map((rate) => rate.toString()),
        }),
    );

    ui.clearActionPrompt();
    ui.write(`Pool deployed at address: ${pool.address}`);
}
