import { NetworkProvider } from '@ton/blueprint';
import { toNano } from '@ton/core';
import { JettonMasterCode, JettonWalletCode } from '../compilables';
import { JettonMaster } from '../wrappers';
import { promptJettonContent } from './helpers/metadata';
import { createDeployStateIfNotExists, saveDeployState } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const senderAddress = provider.sender().address;
    if (!senderAddress) {
        throw new Error('Sender address is not defined');
    }

    const { content, encodedContent } = await promptJettonContent(ui);
    const testJetton = provider.open(
        JettonMaster.createFromConfig(
            {
                admin: senderAddress,
                content: encodedContent,
                wallet_code: await JettonWalletCode,
            },
            await JettonMasterCode,
        ),
    );

    if (await provider.isContractDeployed(testJetton.address)) {
        ui.write(
            `Error: Contract at address ${testJetton.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'testJetton',
            testJetton.address.toString(),
            testJetton.init?.code,
            testJetton.init?.data,
            JSON.stringify(content),
        );
        return;
    }

    await testJetton.sendDeploy(provider.sender(), toNano('0.01'));

    await provider.waitForDeploy(testJetton.address, 20);

    ui.write(`TestJetton deployed at address: ${testJetton.address}`);

    saveDeployState(
        'testJetton',
        testJetton.address.toString(),
        testJetton.init?.code,
        testJetton.init?.data,
        JSON.stringify(content),
    );
}
