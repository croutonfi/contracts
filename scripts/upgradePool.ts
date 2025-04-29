import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { PoolCode } from '../compilables';
import { Factory, Pool } from '../wrappers';
import { buildUpgradeMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract to upgrade',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const { factoryAddress } = await pool.getPoolData();
    const factory = provider.open(Factory.createFromAddress(factoryAddress));

    ui.setActionPrompt(`Upgrading Pool ${pool.address}...`);

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.3'),
        pool.address,
        0n,
        buildUpgradeMessage(await PoolCode),
    );

    ui.clearActionPrompt();

    ui.write(`Pool upgraded`);
}
