import { Address, beginCell, toNano } from '@ton/core';
import { SandboxContract } from '@ton/sandbox';
import { randomUUID } from 'crypto';
import { JettonMasterCode, JettonWalletCode } from '../../compilables';
import { JettonMaster } from '../../wrappers/jetton/JettonMaster';

export async function deployJettonMaster(
    deployerSeed = 'deployer',
    walletCode = JettonWalletCode,
): Promise<SandboxContract<JettonMaster>> {
    const deployer = await blockchain.treasury(deployerSeed);

    const jettonMaster = blockchain.openContract(
        JettonMaster.createFromConfig(
            {
                admin: deployer.address,
                content: beginCell().storeStringTail(randomUUID()).endCell(),
                wallet_code: await walletCode,
            },
            await JettonMasterCode,
        ),
    );

    await jettonMaster.sendDeploy(deployer.getSender(), toNano('0.5'));

    return jettonMaster;
}

export async function deployJettonMasters(
    number = 1,
    deployerSeed = 'deployer',
    walletCode = JettonWalletCode,
): Promise<SandboxContract<JettonMaster>[]> {
    const jettonMasters: SandboxContract<JettonMaster>[] = [];

    for (let i = 0; i < number; i++) {
        jettonMasters.push(await deployJettonMaster(deployerSeed, walletCode));
    }

    return jettonMasters;
}

export async function mintJettons(
    jettonMaster: SandboxContract<JettonMaster>,
    to: Address,
    amount: bigint,
    deployerSeed = 'deployer',
) {
    const deployer = await blockchain.treasury(deployerSeed);
    return await jettonMaster.sendMint(
        deployer.getSender(),
        to,
        amount,
        toNano('0.025'),
        toNano('0.05'),
    );
}
