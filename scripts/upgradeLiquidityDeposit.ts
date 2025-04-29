import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { LiquidityDepositCode } from '../compilables';
import { Factory, LiquidityDeposit } from '../wrappers';
import { buildUpgradeMessage } from '../wrappers/admin';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const liquidityDepositAddress = await ui.inputAddress(
        'Enter LiquidityDeposit contract address to upgrade',
    );

    const liquidityDeposit = provider.open(
        await LiquidityDeposit.createFromAddress(liquidityDepositAddress),
    );

    const allFactoryDeployments = matchDeployFiles('factory');
    const [, factoryDeployment] = await ui.choose(
        'Choose Factory to upgrade LiquidityDeposit',
        allFactoryDeployments,
        ([filename]) => filename,
    );

    const factory = provider.open(
        Factory.createFromAddress(Address.parse(factoryDeployment.address)),
    );

    ui.setActionPrompt(
        `Upgrading LiquidityDeposit ${liquidityDeposit.address}...`,
    );

    await factory.sendAdminAction(
        provider.sender(),
        toNano('0.15'),
        liquidityDeposit.address,
        0n,
        buildUpgradeMessage(await LiquidityDepositCode),
    );

    ui.clearActionPrompt();

    ui.write(`LiquidityDeposit upgraded`);
}
