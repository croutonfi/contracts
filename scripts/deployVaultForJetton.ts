import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { BlankContractCode, JettonVaultCode } from '../compilables';
import { Factory, packVaultConfigToCell, Vault } from '../wrappers';
import { buildJettonToken } from '../wrappers/tokens';
import {
    createDeployStateIfNotExists,
    matchDeployFiles,
    saveDeployState,
} from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();

    const allFactoryDeployments = await matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to deploy Vault',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const jettonAddress = await ui.inputAddress('Enter jetton address:');
    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    const vaultConfig = {
        factoryAddress: factory.address,
        token: buildJettonToken(jettonAddress),
    };
    const vault = provider.open(
        Vault.createFromConfig(
            vaultConfig,
            await BlankContractCode,
            await JettonVaultCode,
        ),
    );

    ui.setActionPrompt(`Deploying Vault for Jetton...`);

    if (await provider.isContractDeployed(vault.address)) {
        ui.write(
            `Error: Contract at address ${vault.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'vault',
            vault.address.toString(),
            await BlankContractCode,
            packVaultConfigToCell(vaultConfig),
            jettonAddress.toString(),
        );

        return;
    }

    await factory.sendDeployVault(
        provider.sender(),
        toNano('0.05'),
        buildJettonToken(jettonAddress),
    );

    await provider.waitForDeploy(vault.address, 20);

    saveDeployState(
        'vault',
        vault.address.toString(),
        await BlankContractCode,
        packVaultConfigToCell(vaultConfig),
        jettonAddress.toString(),
    );

    ui.clearActionPrompt();
    ui.write(`Vault deployed at address: ${vault.address}`);
}
