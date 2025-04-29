import { FactoryCode, LiquidityDepositCode, PoolCode, SharesWalletCode, JettonVaultCode, NativeVaultCode } from '../../compilables';
import { Factory, FactoryConfig} from '../../wrappers/Factory';
import { Address, toNano } from '@ton/core';

export async function factoryConfig(ownerAddress: Address): Promise<FactoryConfig> {
    return {
        ownerAddress,
        poolCode: await PoolCode,
        jettonVaultCode: await JettonVaultCode,
        nativeVaultCode: await NativeVaultCode,
        liquidityDepositCode: await LiquidityDepositCode,
        sharesWalletCode: await SharesWalletCode,
    }
}

export async function deployFactory(value = toNano('0.05'), deployerSeed = 'deployer') {
    const deployer = await blockchain.treasury(deployerSeed);

    /* Deploy Factory */
    const factory = blockchain.openContract(
        Factory.createFromConfig(
            await factoryConfig(deployer.address),
            await FactoryCode,
        ),
    );

    const result = await factory.sendDeploy(
        deployer.getSender(),
        value,
    );

    return { factory, result };
}
