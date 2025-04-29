import { NetworkProvider } from '@ton/blueprint';
import { Address } from '@ton/core';
import { FactoryCode } from '../compilables';
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
        'Choose Factory to upgrade',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    ui.setActionPrompt(`Upgrading Factory ${factory.address}...`);

    await factory.sendUpgrade(provider.sender(), await FactoryCode);

    ui.clearActionPrompt();

    ui.write(`Factory upgraded`);
}
