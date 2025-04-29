import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
} from '@ton/core';

import { buildUpgradeMessage } from './admin';
import { ContractType } from './common';
import { Op } from './constants';
import { Asset, serializeAssetsToCell, serializeRatesToDict } from './Pool';
import { storeToken, Token } from './tokens';
import { roundFee } from './utils/gas';

export type FactoryConfig = {
    ownerAddress: Address;
    jettonVaultCode: Cell;
    nativeVaultCode: Cell;
    poolCode: Cell;
    liquidityDepositCode: Cell;
    sharesWalletCode: Cell;
};

export function packFactoryConfigToCell(config: FactoryConfig): Cell {
    return beginCell()
        .storeAddress(config.ownerAddress)
        .storeRef(
            beginCell()
                .storeRef(config.jettonVaultCode)
                .storeRef(config.nativeVaultCode)
                .endCell(),
        )
        .storeRef(config.poolCode)
        .storeRef(config.liquidityDepositCode)
        .storeRef(config.sharesWalletCode)
        .endCell();
}

export class Factory implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Factory(address);
    }

    static createFromConfig(config: FactoryConfig, code: Cell, workchain = 0) {
        const data = packFactoryConfigToCell(config);
        const address = contractAddress(workchain, {
            code,
            data,
        });

        return new Factory(address, { code, data });
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Cell.EMPTY,
        });
    }

    async sendDeployVault(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        token: Token,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.deploy_vault, 32)
                .storeUint(0, 64)
                .storeWritable(storeToken(token))
                .endCell(),
        });
    }

    async sendDeployPool(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        assets: Asset[],
        rates: bigint[],
        A: bigint,
        fee: bigint,
        adminFee: bigint,
        content: Cell = beginCell().endCell(),
        ratesManager?: Address,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.deploy_pool, 32)
                .storeUint(0, 64)
                .storeRef(serializeAssetsToCell(assets))
                .storeDict(serializeRatesToDict(rates))
                .storeAddress(ratesManager ?? via.address)
                .storeRef(content)
                .storeUint(A, 32)
                .storeUint(fee, 64)
                .storeUint(adminFee, 64)
                .endCell(),
        });
    }

    async sendAdminAction(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        recipient: Address,
        fwdCoins: bigint,
        fwdActionPayload: Cell,
    ) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.admin_action, 32)
                .storeUint(0, 64)
                .storeAddress(recipient)
                .storeCoins(fwdCoins)
                .storeRef(fwdActionPayload)
                .endCell(),
        });
    }

    async sendTransferOwnership(
        provider: ContractProvider,
        via: Sender,
        newOwner: Address,
        value = toNano('0.1'),
    ) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body: beginCell()
                .storeUint(Op.transfer_ownership, 32)
                .storeUint(0, 64)
                .storeAddress(newOwner)
                .endCell(),
        });
    }

    async sendUpdateCode(
        provider: ContractProvider,
        via: Sender,
        contractType: ContractType,
        /**
         * Should be a cell of two cells for vaults
         */
        code: Cell,
        value = toNano('0.1'),
    ) {
        if (contractType === ContractType.Vault && code.refs.length !== 2) {
            throw new Error('Invalid codes for vault');
        }

        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.update_code, 32)
                .storeUint(0, 64)
                .storeUint(contractType, 8)
                .storeRef(code)
                .endCell(),
        });
    }

    async sendUpgrade(
        provider: ContractProvider,
        via: Sender,
        code: Cell,
        fwdMessageBody?: Cell,
        value = toNano('0.1'),
    ) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: buildUpgradeMessage(code, fwdMessageBody),
        });
    }

    async getOwnerAddress(provider: ContractProvider) {
        const result = await provider.get('get_owner_address', []);

        return result.stack.readAddress();
    }

    async getCode(provider: ContractProvider) {
        const result = await provider.get('get_code', []);

        return {
            jettonVaultCode: result.stack.readCell(),
            nativeVaultCode: result.stack.readCell(),
            poolCode: result.stack.readCell(),
            liquidityDepositCode: result.stack.readCell(),
        };
    }

    async getLiquidityDepositAddress(
        provider: ContractProvider,
        ownerAddress: Address,
        poolAddress: Address,
    ) {
        const result = await provider.get('get_liquidity_deposit_addr', [
            {
                type: 'slice',
                cell: beginCell().storeAddress(ownerAddress).endCell(),
            },
            {
                type: 'slice',
                cell: beginCell().storeAddress(poolAddress).endCell(),
            },
        ]);

        return result.stack.readAddress();
    }

    async getVaultAddress(provider: ContractProvider, token: Token) {
        const result = await provider.get('get_vault_addr', [
            {
                type: 'slice',
                cell: beginCell().storeWritable(storeToken(token)).endCell(),
            },
        ]);

        return result.stack.readAddress();
    }

    async getBalance(provider: ContractProvider) {
        const state = await provider.getState();
        return state.balance;
    }

    async getSwapFee(provider: ContractProvider, rounded = true) {
        const result = await provider.get('get_swap_fee', []);

        const fees = [
            result.stack.readBigNumber(),
            result.stack.readBigNumber(),
        ];

        return rounded ? fees.map(roundFee) : fees;
    }

    async getAddLiquidityFee(provider: ContractProvider, rounded = true) {
        const result = await provider.get('get_add_liquidity_fee', []);

        const fees = [
            result.stack.readBigNumber(),
            result.stack.readBigNumber(),
        ];

        return rounded ? fees.map(roundFee) : fees;
    }

    async getDepositAllFee(provider: ContractProvider, rounded = true) {
        const result = await provider.get('get_deposit_all_fee', []);

        const fee = result.stack.readBigNumber();

        return rounded ? roundFee(fee) : fee;
    }

    async getBurnLpFee(
        provider: ContractProvider,
        tokenNumber: number,
        rounded = true,
    ) {
        const result = await provider.get('get_burn_lp_fee', [
            { type: 'int', value: BigInt(tokenNumber) },
        ]);

        const fee = result.stack.readBigNumber();

        return rounded ? roundFee(fee) : fee;
    }
}
