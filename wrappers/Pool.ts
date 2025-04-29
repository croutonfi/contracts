import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
    StateInit,
    toNano,
    TupleBuilder,
    TupleReader,
} from '@ton/core';
import { Maybe } from '@ton/core/dist/utils/maybe';
import { ContractType, initializeMessage } from './common';
import { Op, ZERO_ADDRESS } from './constants';
import { loadToken, storeToken, Token } from './tokens';

export type Asset = {
    token: Token;
    precision: bigint;
    balance: bigint;
    adminFees: bigint;
};

export type PoolDeployConfig = {
    factoryAddress: Address;
    assets: Asset[];
    A: bigint;
};

export type PoolInitConfig = {
    sharesWalletCode: Cell;
    content: Cell;
    initialA: bigint;
    fee: bigint;
    adminFee: bigint;
    rates: bigint[];
    ratesManager?: Address;
};

export function serializeAssetsToCell(assets: Asset[]): Cell {
    let tail = null;

    for (let i = assets.length - 1; i >= 0; i--) {
        tail = beginCell()
            .storeWritable(storeToken(assets[i].token))
            .storeCoins(assets[i].precision)
            .storeCoins(assets[i].balance)
            .storeCoins(assets[i].adminFees)
            .storeMaybeRef(tail)
            .endCell();
    }

    if (!tail) {
        throw new Error('Assets are empty');
    }

    return tail;
}

export function deserealizeAssetsFromCell(assets: Cell): Asset[] {
    const result: Asset[] = [];
    let next: Cell | null = assets;

    while (next !== null) {
        const slice = next.beginParse();

        result.push({
            token: loadToken(slice),
            precision: slice.loadCoins(),
            balance: slice.loadCoins(),
            adminFees: slice.loadCoins(),
        });

        next = slice.loadMaybeRef();
    }

    return result;
}

export function serializeRatesToDict(rates: bigint[]) {
    const result = Dictionary.empty(
        Dictionary.Keys.Uint(32),
        Dictionary.Values.BigUint(128),
    );

    for (let i = 0; i < rates.length; i++) {
        result.set(i, rates[i]);
    }

    return result;
}

export function deserializeRatesFromCell(cell: Cell): bigint[] {
    const rates = Dictionary.loadDirect(
        Dictionary.Keys.Uint(32),
        Dictionary.Values.BigUint(128),
        cell.beginParse(),
    );

    const result: bigint[] = [];

    for (let i = 0; i < rates.keys().length; i++) {
        result.push(rates.get(i)!);
    }

    return result;
}

export function serializeAmountsToCell(amounts: bigint[]): Cell {
    let tail = null;

    for (let i = amounts.length - 1; i >= 0; i--) {
        tail = beginCell().storeCoins(amounts[i]).storeMaybeRef(tail).endCell();
    }

    if (!tail) {
        throw new Error('Amounts are empty');
    }

    return tail;
}

export function prepareRemoveLiquidityBalancedParameters(
    minAmounts: bigint[],
): Cell {
    return beginCell()
        .storeUint(Op.remove_liquidity_balanced, 32)
        .storeRef(serializeAmountsToCell(minAmounts))
        .endCell();
}

export function prepareRemoveLiquidityOneCoinParameters(
    tokenIndex: number,
    minAmountOut: bigint,
): Cell {
    return beginCell()
        .storeUint(Op.remove_liquidity_one_coin, 32)
        .storeUint(tokenIndex, 8)
        .storeCoins(minAmountOut)
        .endCell();
}

export function calcAssetRateAndPrecision(
    decimals: number | bigint,
    rateMultiplier = 1,
) {
    const base = 10n ** 18n;
    const one = 10n ** BigInt(decimals);
    const precision = base / one;

    return {
        rate: base * precision * BigInt(rateMultiplier),
        precision,
        one,
    };
}

export type SwapSteps = {
    pool: Address;
    toToken: Token;
    limit: bigint;
};

export type SwapParams = {
    deadline: number;
    recipient: Address;
    successPayload: Maybe<Cell>;
    failPayload: Maybe<Cell>;
};

export type SwapConfig = {
    steps: SwapSteps;
    params: SwapParams;
};

function swapStepsToCell(steps: SwapSteps[]): Cell {
    let tail = null;
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        tail = beginCell()
            .storeAddress(step.pool)
            .storeWritable(storeToken(step.toToken))
            .storeCoins(step.limit)
            .storeMaybeRef(tail)
            .endCell();
    }

    if (!tail) {
        throw new Error('Steps are empty');
    }

    return tail;
}

function swapParamsToCell(params: SwapParams): Cell {
    return beginCell()
        .storeAddress(params.recipient)
        .storeUint(params.deadline, 64)
        .storeMaybeRef(params.successPayload)
        .storeMaybeRef(params.failPayload)
        .endCell();
}

export function prepareSwapParameters(
    steps: SwapSteps[],
    params: SwapParams,
): Cell {
    return beginCell()
        .storeUint(Op.swap, 32)
        .storeRef(swapStepsToCell(steps))
        .storeRef(swapParamsToCell(params))
        .endCell();
}

export function prepareSwapStep(steps: SwapSteps[]): Cell {
    return swapStepsToCell(steps);
}

export function prepareNativeSwapParameters(
    steps: SwapSteps[],
    params: SwapParams,
    queryId: number,
    amount: bigint,
): Cell {
    return beginCell()
        .storeUint(Op.swap, 32)
        .storeUint(queryId, 64)
        .storeCoins(amount)
        .storeRef(swapStepsToCell(steps))
        .storeRef(swapParamsToCell(params))
        .endCell();
}

export function packPoolDeployConfigToCell(config: PoolDeployConfig): Cell {
    return beginCell()
        .storeAddress(config.factoryAddress)
        .storeUint(ContractType.Pool, 8)
        .storeUint(0, 32) // initialA
        .storeUint(0, 32) // futureA
        .storeUint(0, 64) // intialATime
        .storeUint(0, 64) // futureATime
        .storeUint(0, 64) // fee
        .storeUint(0, 64) // adminFee
        .storeCoins(0) // totalSupply
        .storeRef(serializeAssetsToCell(config.assets))
        .storeDict(
            Dictionary.empty(
                Dictionary.Keys.Uint(32),
                Dictionary.Values.BigVarUint(128),
            ),
        )
        .storeUint(0, 2) // empty address
        .storeRef(beginCell().endCell())
        .storeRef(beginCell().endCell())
        .endCell();
}

export class Pool implements Contract {
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

    static createFromAddress(address: Address) {
        return new Pool(address);
    }

    static createFromConfig(
        config: PoolDeployConfig,
        blankContractCode: Cell,
        code: Cell,
        workchain = 0,
    ) {
        const data = packPoolDeployConfigToCell(config);
        const address = contractAddress(workchain, {
            code: blankContractCode,
            data,
        });

        return new Pool(address, { data, blankContractCode }, code);
    }

    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        config: PoolInitConfig,
    ) {
        const initMsgPayload = beginCell()
            .storeUint(Op.init_pool, 32)
            .storeUint(0, 64)
            .storeUint(config.initialA, 32)
            .storeUint(config.fee, 64)
            .storeUint(config.adminFee, 64)
            .storeDict(serializeRatesToDict(config.rates))
            .storeAddress(config.ratesManager ?? ZERO_ADDRESS)
            .storeRef(config.sharesWalletCode)
            .storeRef(config.content)
            .endCell();

        if (!this.code) {
            throw new Error('Contract code is not set');
        }

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: initializeMessage(this.code, initMsgPayload),
        });
    }

    async sendBurnNotification(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        vaultAddress: Address,
        payoutReceiver: Address,
        amount: bigint,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.burn_notification, 32)
                .storeUint(0, 64)
                .storeAddress(vaultAddress)
                .storeAddress(payoutReceiver)
                .storeCoins(amount)
                .endCell(),
        });
    }

    async sendMessage(
        provider: ContractProvider,
        via: Sender,
        message: Cell,
        value: bigint = toNano('0.05'),
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: message,
        });
    }

    async getJettonData(provider: ContractProvider) {
        let res = await provider.get('get_jetton_data', []);

        let totalSupply = res.stack.readBigNumber();
        let mintable = res.stack.readBoolean();
        let adminAddress = res.stack.readAddress();
        let content = res.stack.readCell();
        let walletCode = res.stack.readCell();

        return {
            totalSupply,
            mintable,
            adminAddress,
            content,
            walletCode,
        };
    }

    async getPoolData(provider: ContractProvider) {
        const result = await provider.get('get_pool_data', []);

        return {
            factoryAddress: result.stack.readAddress(),
            contractType: result.stack.readNumber(),
            assets: result.stack.readCell(),
            rates: result.stack.readCell(),
            A: result.stack.readBigNumber(),
            fee: result.stack.readBigNumber(),
            adminFee: result.stack.readBigNumber(),
            totalSupply: result.stack.readBigNumber(),
            ratesManager: result.stack.readAddress(),
        } as const;
    }

    async getBalances(provider: ContractProvider) {
        const result = await provider.get('get_balances', []);
        const tupleReader = result.stack.readTuple();

        return readTupleOfBigInts(tupleReader);
    }

    async getAdminFeeBalances(provider: ContractProvider) {
        const result = await provider.get('get_admin_fee_balances', []);
        const tupleReader = result.stack.readTuple();

        return readTupleOfBigInts(tupleReader);
    }

    async getRates(provider: ContractProvider) {
        const result = await provider.get('get_rates', []);
        const tupleReader = result.stack.readTuple();

        return readTupleOfBigInts(tupleReader);
    }

    async getVirtualPrice(provider: ContractProvider) {
        const result = await provider.get('get_virtual_price', []);

        return result.stack.readBigNumber();
    }

    async getDy(provider: ContractProvider, i: number, j: number, dx: bigint) {
        const builder = new TupleBuilder();

        builder.writeNumber(i);
        builder.writeNumber(j);
        builder.writeNumber(dx);

        const result = await provider.get('get_dy', builder.build());

        return result.stack.readBigNumber();
    }

    async getCalcTokenAmount(
        provider: ContractProvider,
        amounts: bigint[],
        deposit: boolean,
    ) {
        const builder = new TupleBuilder();
        const amountsTuple = new TupleBuilder();

        for (const amount of amounts) {
            amountsTuple.writeNumber(amount);
        }
        builder.writeTuple(amountsTuple.build());
        builder.writeBoolean(deposit);

        const result = await provider.get(
            'get_calc_token_amount',
            builder.build(),
        );

        return result.stack.readBigNumber();
    }

    async getWithdrawOneCoin(
        provider: ContractProvider,
        sharesToBurn: bigint,
        tokenIndex: number,
    ) {
        const builder = new TupleBuilder();

        builder.writeNumber(sharesToBurn);
        builder.writeNumber(tokenIndex);

        const result = await provider.get(
            'get_calc_withdraw_one_coin',
            builder.build(),
        );

        return result.stack.readBigNumber();
    }

    async getTotalSupply(provider: ContractProvider) {
        const result = await provider.get('get_total_supply', []);

        return result.stack.readBigNumber();
    }

    async getSharesWalletAddress(provider: ContractProvider, owner: Address) {
        const result = await provider.get('get_wallet_address', [
            {
                type: 'slice',
                cell: beginCell().storeAddress(owner).endCell(),
            },
        ]);

        return result.stack.readAddress();
    }
}

function readTupleOfBigInts(t: TupleReader): bigint[] {
    const result: bigint[] = [];

    while (t.remaining > 0) {
        result.push(t.readBigNumber());
    }

    return result;
}

function readTupleOfAddresses(t: TupleReader): Address[] {
    const result: Address[] = [];

    while (t.remaining > 0) {
        result.push(t.readAddress());
    }

    return result;
}
