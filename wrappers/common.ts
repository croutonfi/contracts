import { Address, beginCell, Builder, Cell, Writable } from '@ton/core';
import { Op } from './constants';

export enum ContractType {
    Vault = 1,
    Pool = 2,
    LiquidityDeposit = 3,
}

export function buildContractState(
    factoryAddress: Address,
    contractType: ContractType,
    params: ((builder: Builder) => void) | Writable,
): Cell {
    return beginCell()
        .storeAddress(factoryAddress)
        .storeUint(contractType, 8)
        .storeWritable(params)
        .endCell();
}

export function initializeMessage(code: Cell, fwdMessageBody?: Cell) {
    return beginCell()
        .storeUint(Op.initialize, 32)
        .storeUint(0, 64)
        .storeRef(code)
        .storeMaybeRef(fwdMessageBody)
        .endCell();
}
