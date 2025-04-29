import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { BlankContractCode, NativeVaultCode } from '../compilables';
import { Factory, packVaultConfigToCell, Vault } from '../wrappers';
import { buildNativeToken } from '../wrappers/tokens';
import {
    createDeployStateIfNotExists,
    matchDeployFiles,
    saveDeployState,
} from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const allFactoryDeployments = await matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to deploy Native Vault',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    const vaultConfig = {
        factoryAddress: factory.address,
        token: buildNativeToken(),
    };
    const vault = provider.open(
        Vault.createFromConfig(
            vaultConfig,
            await BlankContractCode,
            await NativeVaultCode,
        ),
    );

    ui.setActionPrompt(`Deploying Native Vault...`);

    if (await provider.isContractDeployed(vault.address)) {
        ui.write(
            `Error: Contract at address ${vault.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'native_vault',
            vault.address.toString(),
            await BlankContractCode,
            packVaultConfigToCell(vaultConfig),
        );

        return;
    }

    await factory.sendDeployVault(
        provider.sender(),
        toNano('0.05'),
        buildNativeToken(),
    );

    await provider.waitForDeploy(vault.address, 30);

    saveDeployState(
        'native_vault',
        vault.address.toString(),
        await BlankContractCode,
        packVaultConfigToCell(vaultConfig),
    );

    ui.clearActionPrompt();
    ui.write(`Vault deployed at address: ${vault.address}`);
}
