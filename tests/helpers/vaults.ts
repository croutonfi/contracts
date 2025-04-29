import { Address, beginCell, Cell, Contract, toNano } from '@ton/core';
import {
    SandboxContract,
    SendMessageResult,
    TreasuryContract,
} from '@ton/sandbox';
import { flattenTransaction } from '@ton/test-utils';
import {
    BlankContractCode,
    JettonVaultCode,
    NativeVaultCode,
} from '../../compilables';
import { Factory } from '../../wrappers/Factory';
import { Vault } from '../../wrappers/Vault';
import { Op } from '../../wrappers/constants';
import { JettonMaster } from '../../wrappers/jetton/JettonMaster';
import { JettonWallet } from '../../wrappers/jetton/JettonWallet';
import { buildJettonToken, buildNativeToken } from '../../wrappers/tokens';

export async function deployJettonVault(
    factory: SandboxContract<Factory>,
    jettonMaster: SandboxContract<JettonMaster>,
    deployerSeed = 'deployer',
) {
    const deployer = await blockchain.treasury(deployerSeed);

    const token = buildJettonToken(jettonMaster.address);
    const result = await factory.sendDeployVault(
        deployer.getSender(),
        toNano('0.05'),
        token,
    );

    const vault = blockchain.openContract(
        Vault.createFromConfig(
            {
                factoryAddress: factory.address,
                token,
            },
            await BlankContractCode,
            await JettonVaultCode,
        ),
    );

    return { vault, result };
}

export async function deployNativeVault(
    factory: SandboxContract<Factory>,
    deployerSeed = 'deployer',
) {
    const deployer = await blockchain.treasury(deployerSeed);

    const token = buildNativeToken();
    const result = await factory.sendDeployVault(
        deployer.getSender(),
        toNano('0.05'),
        token,
    );

    const vault = blockchain.openContract(
        Vault.createFromConfig(
            {
                factoryAddress: factory.address,
                token,
            },
            await BlankContractCode,
            await NativeVaultCode,
        ),
    );

    return { vault, result };
}

export async function addJettonLiquidity(
    vault: SandboxContract<Vault>,
    wallet: SandboxContract<JettonWallet>,
    amount: bigint,
    pool: SandboxContract<Contract>,
    user: SandboxContract<TreasuryContract>,
    transferJettonFee: bigint = toNano('0.5'),
    addLiquidityFee: bigint = toNano('0.5'),
    expectedTokenCount = 0,
    minSharesOut: bigint = 0n,
) {
    const fwdPayload = beginCell()
        .storeUint(Op.add_liquidity, 32)
        .storeAddress(pool.address)
        .storeUint(expectedTokenCount, 8)
        .storeCoins(minSharesOut)
        .endCell();

    return await wallet.sendTransfer(
        user.getSender(),
        transferJettonFee + addLiquidityFee,
        amount,
        vault.address,
        user.address,
        Cell.EMPTY,
        addLiquidityFee,
        fwdPayload,
    );
}

export async function addNativeLiquidity(
    vault: SandboxContract<Vault>,
    amount: bigint,
    pool: SandboxContract<Contract>,
    user: SandboxContract<TreasuryContract>,
    fee: bigint = toNano('0.5'),
    expectedTokenCount = 0,
    minSharesOut: bigint = 0n,
) {
    const body = beginCell()
        .storeUint(Op.add_liquidity, 32)
        .storeUint(0, 64)
        .storeCoins(amount)
        .storeAddress(pool.address)
        .storeUint(expectedTokenCount, 8)
        .storeCoins(minSharesOut)
        .endCell();

    return await vault.sendMessage(user.getSender(), body, amount + fee);
}

export function payoutMessage(
    recipient: Address,
    amount: bigint,
    poolProof: Cell,
    fwdPayload?: Cell,
) {
    return beginCell()
        .storeUint(Op.payout, 32)
        .storeUint(0, 64)
        .storeAddress(recipient)
        .storeCoins(amount)
        .storeRef(poolProof)
        .storeMaybeRef(fwdPayload)
        .endCell();
}

export function expectNativePayoutTxValue(
    result: SendMessageResult,
    expectedAmount: bigint,
) {
    const payoutTxIndex = result.transactions.findIndex(
        (t) => flattenTransaction(t).op == Op.payout,
    );
    const transferTxIndex = payoutTxIndex + 1;

    const payoutTx = result.transactions[payoutTxIndex];
    const transferTx = result.transactions[transferTxIndex];

    if (payoutTx.description.type !== 'generic') {
        throw new Error('Payout transaction is not generic');
    }
    if (payoutTx.description.computePhase.type !== 'vm') {
        throw new Error('Payout transaction is not vm');
    }
    if (transferTx.description.type !== 'generic') {
        throw new Error('Transfer transaction is not generic');
    }

    const actualAmount =
        payoutTx.description.computePhase.gasFees +
        payoutTx.description.actionPhase!.totalFwdFees! +
        transferTx.description.creditPhase!.credit.coins -
        payoutTx.description.creditPhase!.credit.coins;

    expect(actualAmount).toEqual(expectedAmount);
}
