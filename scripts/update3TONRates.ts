import BN from 'bignumber.js';

import { NetworkProvider, UIProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { deserealizeAssetsFromCell, Pool } from '../wrappers';
import { buildUpdateRatesMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export function computeRate(decimals: bigint, rateMultiplier: BN) {
    const base = 10n ** 18n;
    const one = 10n ** decimals;
    const precision = base / one;

    return {
        rate: new BN(base.toString())
            .times(precision.toString())
            .times(rateMultiplier)
            .integerValue(BN.ROUND_DOWN),
        precision,
        one,
    };
}

export async function get_tsTONRateMultiplier(): Promise<BN> {
    const request = await fetch('https://cache-manager.ton-tech.org/data');
    const data = await request.json();

    return new BN(data.staking_data.tsTONPrice);
}

export async function get_stTONRateMultiplier(ui: UIProvider) {
    const stTONRate = new BN(await ui.input('Enter stTON price in TON:'));

    return stTONRate;
}

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const ratesManager = provider.sender().address;
    if (!ratesManager) {
        throw new Error('Rates manager address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose 3TON Pool contract where to change rates',
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

    // we expect the order to be TON -> stTON -> tsTON
    const newRates = [
        new BN(1),
        await get_stTONRateMultiplier(ui),
        await get_tsTONRateMultiplier(),
    ].map((multiplier) => {
        return BigInt(computeRate(9n, multiplier).rate.toFixed());
    });

    if (assets.length !== newRates.length) {
        ui.write(`Number of assets and rates should be equal`);
        return;
    }

    ui.write('New rates: ');
    ui.write(newRates.join('\n'));

    const isAdminSure = await ui.prompt(
        'Are you sure you want to set these rates?',
    );

    if (isAdminSure) {
        ui.setActionPrompt(`Updating Pool ${pool.address} rates...`);

        await pool.sendMessage(
            provider.sender(),
            buildUpdateRatesMessage(newRates),
            toNano('0.02'),
        );

        ui.clearActionPrompt();

        ui.write(`Pool rates updated`);
    } else {
        ui.write(`Operation cancelled`);
    }
}
