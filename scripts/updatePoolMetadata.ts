import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { Factory, Pool } from '../wrappers';
import { buildChangeContentMsg } from '../wrappers/admin';
import { promptJettonContent } from './helpers/metadata';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract where to change content',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const { factoryAddress } = await pool.getPoolData();
    const factory = provider.open(Factory.createFromAddress(factoryAddress));
    const { encodedContent } = await promptJettonContent(ui);

    ui.setActionPrompt(`Updating Pool ${pool.address} metadata...`);

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.05'),
        pool.address,
        toNano('0.025'),
        buildChangeContentMsg(encodedContent),
    );

    ui.clearActionPrompt();

    ui.write(`Pool metadata updated`);
}
