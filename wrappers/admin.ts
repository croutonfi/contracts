import { Address, beginCell, Cell } from '@ton/core';
import { Op } from './constants';
import { serializeRatesToDict } from './Pool';
import { storeToken, Token } from './tokens';

// jettons
export function buildChangeContentMsg(content: Cell): Cell {
    return beginCell()
        .storeUint(Op.change_content, 32)
        .storeUint(0, 64)
        .storeRef(content)
        .endCell();
}

// pool

export function buildUpdateFeesMessage(fee: bigint, admin_fee: bigint): Cell {
    return beginCell()
        .storeUint(Op.update_fees, 32)
        .storeUint(0, 64)
        .storeUint(fee, 64)
        .storeUint(admin_fee, 64)
        .endCell();
}

export function buildUpdateAMessage(A: bigint, A_time: number): Cell {
    return beginCell()
        .storeUint(Op.update_A, 32)
        .storeUint(0, 64)
        .storeUint(A, 32)
        .storeUint(A_time, 64)
        .endCell();
}

export function buildStopUpdateAMessage(): Cell {
    return beginCell()
        .storeUint(Op.stop_update_A, 32)
        .storeUint(0, 64)
        .endCell();
}

export function buildUpdateRatesManagerMessage(ratesManager: Address): Cell {
    return beginCell()
        .storeUint(Op.update_rates_manager, 32)
        .storeUint(0, 64)
        .storeAddress(ratesManager)
        .endCell();
}

export function buildUpdateRatesMessage(rates: bigint[]): Cell {
    return beginCell()
        .storeUint(Op.update_rates, 32)
        .storeUint(0, 64)
        .storeDict(serializeRatesToDict(rates))
        .endCell();
}

export function buildUpgradeMessage(code: Cell, fwdMessageBody?: Cell): Cell {
    return beginCell()
        .storeUint(Op.upgrade, 32)
        .storeUint(0, 64)
        .storeRef(code)
        .storeMaybeRef(fwdMessageBody)
        .endCell();
}

export function buildWithdrawAdminFeesMessage(
    token: Token,
    to: Address,
    amount: bigint,
) {
    return beginCell()
        .storeUint(Op.withdraw_admin_fees, 32)
        .storeUint(0, 64)
        .storeWritable(storeToken(token))
        .storeAddress(to)
        .storeCoins(amount)
        .endCell();
}

// vault

export function buildWithdrawJettonsMessage(
    jettonWalletAddress: Address,
    to: Address,
    amount: bigint,
) {
    return beginCell()
        .storeUint(Op.withdraw_jettons, 32)
        .storeUint(0, 64)
        .storeAddress(jettonWalletAddress)
        .storeAddress(to)
        .storeCoins(amount)
        .endCell();
}

export function buildWithdrawTonMessage(to: Address, amount: bigint) {
    return beginCell()
        .storeUint(Op.withdraw_tons, 32)
        .storeUint(0, 64)
        .storeAddress(to)
        .storeCoins(amount)
        .endCell();
}
