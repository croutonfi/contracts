import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Factory, Pool } from '../wrappers';
import { buildUpdateRatesManagerMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const ratesManager = provider.sender().address;
    if (!ratesManager) {
        throw new Error('Deployer address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract where to change rates manager',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const address = await ui.input('Enter new rates manager address');
    const ratesManagerAddress = Address.parse(address);

    const { factoryAddress } = await pool.getPoolData();
    const factory = provider.open(Factory.createFromAddress(factoryAddress));

    ui.setActionPrompt(`Updating Pool ${pool.address} rates manager...`);

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.04'),
        pool.address,
        toNano('0.02'),
        buildUpdateRatesManagerMessage(ratesManagerAddress),
    );

    ui.clearActionPrompt();

    ui.write(`Done`);
}
