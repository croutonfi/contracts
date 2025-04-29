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

    const allTestJettonDeployments = await matchDeployFiles('testJetton');
    const [, testJettonDeployment] = await ui.choose(
        'Choose TestJetton to deploy its Vault',
        allTestJettonDeployments,
        ([filename, { meta }]) => {
            const parsedMeta = JSON.parse(meta);
            return `${filename} ${parsedMeta.name} ${parsedMeta.symbol} (${parsedMeta.decimals})`;
        },
    );

    const testJettonMasterAddress = Address.parse(testJettonDeployment.address);
    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    const vaultConfig = {
        factoryAddress: factory.address,
        token: buildJettonToken(testJettonMasterAddress),
    };
    const vault = provider.open(
        Vault.createFromConfig(
            vaultConfig,
            await BlankContractCode,
            await JettonVaultCode,
        ),
    );

    ui.setActionPrompt(`Deploying Vault for TestJetton...`);

    if (await provider.isContractDeployed(vault.address)) {
        ui.write(
            `Error: Contract at address ${vault.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'vault',
            vault.address.toString(),
            await BlankContractCode,
            packVaultConfigToCell(vaultConfig),
            testJettonMasterAddress.toString(),
        );

        return;
    }

    await factory.sendDeployVault(
        provider.sender(),
        toNano('0.05'),
        buildJettonToken(testJettonMasterAddress),
    );

    await provider.waitForDeploy(vault.address, 20);

    saveDeployState(
        'vault',
        vault.address.toString(),
        await BlankContractCode,
        packVaultConfigToCell(vaultConfig),
        testJettonMasterAddress.toString(),
    );

    ui.clearActionPrompt();
    ui.write(`Vault deployed at address: ${vault.address}`);
}
