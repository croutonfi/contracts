import { NetworkProvider } from '@ton/blueprint';
import { Address, beginCell, toNano } from '@ton/core';
import {
    JettonVaultCode,
    LiquidityDepositCode,
    NativeVaultCode,
    PoolCode,
} from '../compilables';
import { ContractType, Factory } from '../wrappers';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allFactoryDeployments = matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to upgrade codes',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    const mapContractTypeToString = (contractType: ContractType) =>
        ({
            [ContractType.Vault]: 'Vault',
            [ContractType.Pool]: 'Pool',
            [ContractType.LiquidityDeposit]: 'LiquidityDeposit',
        })[contractType];

    const contractType = await ui.choose(
        'Choose contract type:',
        [ContractType.Vault, ContractType.Pool, ContractType.LiquidityDeposit],
        mapContractTypeToString,
    );

    const code = {
        [ContractType.Vault]: beginCell()
            .storeRef(await JettonVaultCode)
            .storeRef(await NativeVaultCode)
            .endCell(),
        [ContractType.Pool]: await PoolCode,
        [ContractType.LiquidityDeposit]: await LiquidityDepositCode,
    }[contractType];

    await factory.sendUpdateCode(
        provider.sender(),
        contractType,
        code,
        toNano('0.2'),
    );

    ui.setActionPrompt(
        `Upgrading ${mapContractTypeToString(contractType)} code on Factory ${factory.address}...`,
    );

    ui.clearActionPrompt();

    ui.write(`Code upgraded`);
}
