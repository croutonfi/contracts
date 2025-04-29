import { NetworkProvider } from '@ton/blueprint';
import { Address, Cell, toNano } from '@ton/core';
import { Factory } from '../wrappers';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allFactoryDeployments = matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    const recipient = await ui.inputAddress('Enter recipient address:');
    const amount = BigInt(await ui.input(`Enter amount to withdraw`));

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.1'),
        recipient,
        amount,
        Cell.EMPTY,
    );

    ui.clearActionPrompt();

    ui.write(`Funds withdrawn`);
}
