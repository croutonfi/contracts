import { NetworkProvider } from '@ton/blueprint';
import { Address, toNano } from '@ton/core';
import { JettonMaster } from '../wrappers';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allTestJettonDeployments = await matchDeployFiles('testJetton');
    const [, testJettonDeployment] = await ui.choose(
        'Choose TestJetton contract to mint tokens',
        allTestJettonDeployments,
        ([filename, { meta }]) => {
            const parsedMeta = JSON.parse(meta);
            return `${filename} ${parsedMeta.name} ${parsedMeta.symbol} (${parsedMeta.decimals})`;
        },
    );

    const testJetton = provider.open(
        JettonMaster.createFromAddress(
            Address.parse(testJettonDeployment.address),
        ),
    );

    const receiver =
        (await ui.input('Enter receiver address (default=deployer):')) ||
        deployerAddress.toString();

    const amount = BigInt(
        await ui.input('Enter amount of tokens to mint (in nano):'),
    );

    ui.setActionPrompt(`Minting tokens...`);

    await testJetton.sendMint(
        provider.sender(),
        Address.parse(receiver),
        amount,
        toNano('0.025'),
        toNano('0.05'),
    );

    ui.clearActionPrompt();
    ui.write(`Tokens minted successfully`);
}
