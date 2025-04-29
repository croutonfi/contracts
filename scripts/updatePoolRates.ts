import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { deserealizeAssetsFromCell, Pool } from '../wrappers';
import { buildUpdateRatesMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const ratesManager = provider.sender().address;
    if (!ratesManager) {
        throw new Error('Rates manager address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract where to change rates',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const { ratesManager: poolRatesManager, assets: assetsCell } =
        await pool.getPoolData();
    const assets = deserealizeAssetsFromCell(assetsCell);

    if (!ratesManager.equals(poolRatesManager)) {
        ui.write(`You are not an action manager of this pool`);
        return;
    }

    const rates = await ui.input('Enter new rates (comma separated)');
    const newRates = rates.split(',').map(BigInt);

    if (assets.length !== newRates.length) {
        ui.write(`Number of assets and rates should be equal`);
        return;
    }

    ui.setActionPrompt(`Updating Pool ${pool.address} rates...`);

    await pool.sendMessage(
        provider.sender(),
        buildUpdateRatesMessage(newRates),
        toNano('0.02'),
    );

    ui.clearActionPrompt();

    ui.write(`Pool rates updated`);
}
