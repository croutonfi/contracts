import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    StateInit,
    toNano,
} from '@ton/core';
import { Maybe } from '@ton/core/dist/utils/maybe';
import { buildContractState, ContractType, initializeMessage } from './common';
import { Op } from './constants';
import { storeToken, Token } from './tokens';

type LiquidityDepositConfig = {
    factoryAddress: Address;
    ownerAddress: Address;
    poolAddress: Address;
};

export function packLiquidityDepositConfigToCell(
    config: LiquidityDepositConfig,
): Cell {
    return buildContractState(
        config.factoryAddress,
        ContractType.LiquidityDeposit,
        (builder) => {
            return builder
                .storeAddress(config.ownerAddress)
                .storeAddress(config.poolAddress)
                .storeMaybeRef();
        },
    );
}

export class LiquidityDeposit implements Contract {
    readonly init?: Maybe<StateInit>;

    constructor(
        readonly address: Address,
        init?: { blankContractCode: Cell; data: Cell },
        readonly code?: Cell,
    ) {
        if (init) {
            this.init = {
                code: init?.blankContractCode,
                data: init?.data,
            };
        }
    }

    static async createFromAddress(address: Address) {
        return new LiquidityDeposit(address);
    }

    static createFromConfig(
        config: LiquidityDepositConfig,
        blankContractCode: Cell,
        code: Cell,
        workchain = 0,
    ) {
        const data = packLiquidityDepositConfigToCell(config);
        const address = contractAddress(workchain, {
            code: blankContractCode,
            data,
        });

        return new LiquidityDeposit(address, { data, blankContractCode }, code);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        if (!this.code) {
            throw new Error('Contract code is not set');
        }

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: initializeMessage(this.code, Cell.EMPTY),
        });
    }

    // in regular conditions is sent from factory
    async sendDepositNotification(
        provider: ContractProvider,
        via: Sender,
        token: Token,
        tokenAmount: bigint,
        expectedTokenCount = 0,
        minSharesOut: bigint = 0n,
    ) {
        await provider.internal(via, {
            value: toNano('0.01'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.initialize, 32)
                .storeUint(0, 64)
                .storeRef(Cell.EMPTY)
                .storeMaybeRef(
                    beginCell()
                        .storeUint(Op.deposit_notification, 32)
                        .storeUint(0, 64)
                        .storeWritable(storeToken(token))
                        .storeCoins(tokenAmount)
                        .storeUint(expectedTokenCount, 8)
                        .storeCoins(minSharesOut)
                        .endCell(),
                )
                .endCell(),
        });
    }

    async sendDepositAll(
        provider: ContractProvider,
        via: Sender,
        value = toNano('0.3'),
        minSharesOut: bigint = 0n,
    ) {
        const msgBody = beginCell()
            .storeUint(Op.deposit_all, 32)
            .storeUint(0, 64)
            .storeCoins(minSharesOut)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msgBody,
        });
    }

    async sendMessage(
        provider: ContractProvider,
        via: Sender,
        message: Cell,
        value: bigint = toNano('0.1'),
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: message,
        });
    }

    async getLiquidityDepositData(provider: ContractProvider) {
        const result = await provider.get('get_liquidity_deposit_data', []);

        return [
            result.stack.readAddress(),
            result.stack.readNumber(),
            result.stack.readAddress(),
            result.stack.readAddress(),
            result.stack.readTuple(),
            result.stack.readTuple(),
        ] as const;
    }
}
