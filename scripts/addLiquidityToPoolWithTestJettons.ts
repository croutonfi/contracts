import { NetworkProvider } from '@ton/blueprint';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import {
    BlankContractCode,
    JettonVaultCode,
    LiquidityDepositCode,
    NativeVaultCode,
} from '../compilables';
import {
    Factory,
    JettonMaster,
    JettonWallet,
    LiquidityDeposit,
    Pool,
    Vault,
} from '../wrappers';
import { Op } from '../wrappers/constants';
import { buildJettonToken, buildNativeToken } from '../wrappers/tokens';
import { matchDeployFiles } from './utils';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const deployerAddress = provider.sender().address;
    if (!deployerAddress) {
        throw new Error('Deployer address is not set');
    }

    const allPoolDeploys = matchDeployFiles('pool');
    const [, poolDeploy] = await ui.choose(
        'Choose Pool contract to add liquidity to',
        allPoolDeploys,
        ([filename]) => `${filename}`,
    );

    const pool = provider.open(
        Pool.createFromAddress(Address.parse(poolDeploy.address)),
    );

    const poolTokens = JSON.parse(poolDeploy.meta); // ideally we should get tokens from getter method
    const { factoryAddress } = await pool.getPoolData();
    const factory = provider.open(Factory.createFromAddress(factoryAddress));
    const [addLiquidityJettonFee, addLiquidityFee] =
        await factory.getAddLiquidityFee();

    // tokenIdentifier is jettonMasterAddress or NATIVE_TON
    for (const [tokenIdentifier] of poolTokens) {
        const amount = BigInt(
            await ui.input(
                `Enter amount of ${tokenIdentifier} to add to liquidity (in nano):`,
            ),
        );

        if (amount === 0n) {
            continue;
        }

        if (tokenIdentifier === 'NATIVE_TON') {
            const vault = provider.open(
                Vault.createFromConfig(
                    {
                        factoryAddress,
                        token: buildNativeToken(),
                    },
                    await BlankContractCode,
                    await NativeVaultCode,
                ),
            );

            const body = beginCell()
                .storeUint(Op.add_liquidity, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(pool.address)
                .storeUint(0, 8)
                .storeCoins(0)
                .endCell();

            const fee = toNano('0.3');

            await vault.sendMessage(provider.sender(), body, amount + fee);
        } else {
            const jettonMaster = provider.open(
                JettonMaster.createFromAddress(Address.parse(tokenIdentifier)),
            );

            const vault = provider.open(
                Vault.createFromConfig(
                    {
                        factoryAddress,
                        token: buildJettonToken(jettonMaster.address),
                    },
                    await BlankContractCode,
                    await JettonVaultCode,
                ),
            );

            const deployerJettonWalletAddress =
                await jettonMaster.getWalletAddress(deployerAddress);

            const deployerJettonWallet = provider.open(
                JettonWallet.createFromAddress(deployerJettonWalletAddress),
            );

            const fwdPayload = beginCell()
                .storeUint(Op.add_liquidity, 32)
                .storeAddress(pool.address)
                .storeUint(0, 8)
                .storeCoins(0)
                .endCell();

            await ui.setActionPrompt(
                `Sending ${tokenIdentifier} jettons to vault`,
            );

            await deployerJettonWallet.sendTransfer(
                provider.sender(),
                addLiquidityJettonFee + addLiquidityFee,
                amount,
                vault.address,
                deployerAddress,
                Cell.EMPTY,
                addLiquidityFee,
                fwdPayload,
            );
        }

        await new Promise((resolve) => setTimeout(resolve, 15000));

        await ui.clearActionPrompt();
    }

    await ui.setActionPrompt('Sending depositAll to liquidity deposit');

    const liquidityDeposit = await provider.open(
        LiquidityDeposit.createFromConfig(
            {
                poolAddress: pool.address,
                factoryAddress: factory.address,
                ownerAddress: deployerAddress,
            },
            await BlankContractCode,
            await LiquidityDepositCode,
        ),
    );

    await liquidityDeposit.sendDepositAll(
        provider.sender(),
        await factory.getDepositAllFee(),
    );

    await new Promise((resolve) => setTimeout(resolve, 15000));

    ui.clearActionPrompt();

    ui.write(`Tokens deposited into liquidity successfully`);
}
