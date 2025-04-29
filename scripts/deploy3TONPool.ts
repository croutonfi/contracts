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
    matchDeployFiles,
    saveDeployState,
} from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const allFactoryDeployments = matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to deploy 3TON pool',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const A = BigInt(
        (await ui.input(
            'Enter the A parameter for the new pool (default=200):',
        )) || '200',
    );
    const fee = BigInt(
        (await ui.input(
            'Enter the fee parameter for the new pool (default=1000000):',
        )) || '1000000',
    );
    const adminFee = BigInt(
        (await ui.input(
            'Enter the admin fee parameter for the new pool (default=5000000000):',
        )) || FEE_DENOMINATOR / 2n,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    ui.setActionPrompt(`Deploying 3TON pool with specified parameters...`);

    const assets: Asset[] = [
        {
            token: buildNativeToken(),
            adminFees: 0n,
            balance: 0n,
            ...calcAssetRateAndPrecision(9n),
        },
        {
            token: buildJettonToken(
                Address.parse(
                    'EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k',
                ), //stTON master
            ),
            adminFees: 0n,
            balance: 0n,
            ...calcAssetRateAndPrecision(9n),
        },
        {
            token: buildJettonToken(
                Address.parse(
                    'EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav',
                ), //tsTON master
            ),
            adminFees: 0n,
            balance: 0n,
            ...calcAssetRateAndPrecision(9n),
        },
    ];

    const rates = assets.map(() => calcAssetRateAndPrecision(BigInt(9n)).rate);

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
