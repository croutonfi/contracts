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
import { loadToken, storeToken, Token } from './tokens';

type VaultConfig = {
    factoryAddress: Address;
    token: Token;
};

export function packVaultConfigToCell(config: VaultConfig): Cell {
    return buildContractState(
        config.factoryAddress,
        ContractType.Vault,
        (builder) => {
            return builder
                .storeWritable(storeToken(config.token))
                .storeUint(0, 2);
        },
    );
}

export class Vault implements Contract {
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
        return new Vault(address);
    }

    static createFromConfig(
        config: VaultConfig,
        blankContractCode: Cell,
        code: Cell,
        workchain = 0,
    ) {
        const data = packVaultConfigToCell(config);
        const address = contractAddress(workchain, {
            code: blankContractCode,
            data,
        });

        return new this(address, { data, blankContractCode }, code);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        const fwdMsgBody = beginCell()
            .storeUint(Op.init_vault, 32)
            .storeUint(0, 64)
            .endCell();

        if (!this.code) {
            throw new Error('Contract code is not set');
        }

        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: initializeMessage(this.code, fwdMsgBody),
        });
    }

    async getVaultData(provider: ContractProvider) {
        const result = await provider.get('get_vault_data', []);

        const factoryAddress = result.stack.readAddress();
        const contractType = result.stack.readNumber();
        const token = loadToken(result.stack.readCell().beginParse());

        return [factoryAddress, contractType, token] as const;
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

    async getState(provider: ContractProvider) {
        return await provider.getState();
    }
}
