import { NetworkProvider } from '@ton/blueprint';
import { Address } from '@ton/core';
import {
    deserealizeAssetsFromCell,
    deserializeRatesFromCell,
    Pool,
} from '../wrappers';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const { rates, assets } = await pool.getPoolData();

    ui.write(
        'Tokens:' +
            deserealizeAssetsFromCell(assets)
                .map(
                    (asset) =>
                        asset.token.jettonMasterAddress?.toString() ||
                        'NATIVE_TON',
                )
                .join(', '),
    );

    ui.write(
        `Rates: ${deserializeRatesFromCell(rates).map((rate) =>
            rate.toString(),
        )}`,
    );
}
