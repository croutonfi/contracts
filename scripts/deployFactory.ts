import { NetworkProvider } from '@ton/blueprint';
import { toNano } from '@ton/core';
import {
    FactoryCode,
    JettonVaultCode,
    LiquidityDepositCode,
    NativeVaultCode,
    PoolCode,
    SharesWalletCode,
} from '../compilables';
import { Factory } from '../wrappers/Factory';
import { createDeployStateIfNotExists, saveDeployState } from './utils';

export async function run(provider: NetworkProvider) {
    const ownerAddress = provider.sender().address;

    if (!ownerAddress) {
        throw new Error('Owner address is not defined');
    }

    const ui = provider.ui();
    const factory = provider.open(
        Factory.createFromConfig(
            {
                ownerAddress,
                liquidityDepositCode: await LiquidityDepositCode,
                poolCode: await PoolCode,
                sharesWalletCode: await SharesWalletCode,
                jettonVaultCode: await JettonVaultCode,
                nativeVaultCode: await NativeVaultCode,
            },
            await FactoryCode,
        ),
    );

    if (await provider.isContractDeployed(factory.address)) {
        ui.write(
            `Error: Contract at address ${factory.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'factory',
            factory.address.toString(),
            factory.init?.code,
            factory.init?.data,
        );
        return;
    }

    await factory.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(factory.address);

    ui.write(`Factory deployed at address: ${factory.address}`);

    saveDeployState(
        'factory',
        factory.address.toString(),
        factory.init?.code,
        factory.init?.data,
    );
}
