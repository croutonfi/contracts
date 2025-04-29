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
} from '@ton/core';
import { Maybe } from '@ton/core/dist/utils/maybe';
import { initializeMessage } from './common';
import { Op } from './constants';

export class MockContract implements Contract {
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
        return new MockContract(address);
    }

    static createFromConfig(
        data: Cell,
        blankContractCode: Cell,
        code: Cell,
        workchain = 0,
    ) {
        const address = contractAddress(workchain, {
            code: blankContractCode,
            data,
        });

        return new MockContract(address, { data, blankContractCode }, code);
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

    async sendForwardMessage(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        recipient: Address,
        message: Cell,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.forward_msg, 32)
                .storeUint(0, 64)
                .storeAddress(recipient)
                .storeRef(message)
                .endCell(),
        });
    }

    async getState(provider: ContractProvider) {
        return await provider.getState();
    }
}
