import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { NativeVaultCode } from '../compilables';
import { Factory, Vault } from '../wrappers';
import { buildUpgradeMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const vaultDeploys = matchDeployFiles('native_vault');
    const [, vaultDeploy] = await ui.choose(
        'Choose NativeVault contract to upgrade',
        vaultDeploys,
        ([filename]) => `${filename}`,
    );

    const vault = provider.open(
        Vault.createFromAddress(Address.parse(vaultDeploy.address)),
    );

    const [factoryAddress] = await vault.getVaultData();
    const factory = provider.open(Factory.createFromAddress(factoryAddress));

    ui.setActionPrompt(`Upgrading NativeVault ${vault.address}...`);

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.3'),
        vault.address,
        0n,
        buildUpgradeMessage(await NativeVaultCode),
    );

    ui.clearActionPrompt();

    ui.write(`Vault upgraded`);
}
