import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    DictionaryValue,
    Sender,
    SendMode,
    Slice,
    toNano,
} from '@ton/core';
import { Op } from './constants';

export type OracleConfig = {
    ownerAddress: Address;
    validSignersThreshold: number;
    validSourcesThreshold: number;
    maxTimestampDelay: number;
    trustedSigners: Dictionary<bigint, boolean>;
    certificateTrustStore: Dictionary<bigint, boolean>;
    priceRecords: Dictionary<number, PriceRecord>;
};

export function packOracleConfigToCell(config: OracleConfig): Cell {
    return beginCell()
        .storeAddress(config.ownerAddress)
        .storeUint(config.validSignersThreshold, 8)
        .storeUint(config.validSourcesThreshold, 8)
        .storeUint(config.maxTimestampDelay, 64)
        .storeDict(config.trustedSigners)
        .storeDict(config.certificateTrustStore)
        .storeDict(config.priceRecords)
        .endCell();
}

export class Oracle implements Contract {
    static readonly ACURAST_SIGNATURE_PREFIX = 'acusig';
    static readonly ACURAST_SCRIPT_PREFIX =
        'ipfs://QmVHRimsTBSEASEcnbd5MYLKzphBu1MfZqajKqtWrC3Zbm';

    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Oracle(address);
    }

    static createFromConfig(config: OracleConfig, code: Cell, workchain = 0) {
        const data = packOracleConfigToCell(config);
        const address = contractAddress(workchain, {
            code,
            data,
        });
        return new Oracle(address, { code, data });
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Cell.EMPTY,
        });
    }

    async sendTransferOwnership(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        newOwner: Address,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.transfer_ownership, 32)
            .storeUint(queryId, 64)
            .storeAddress(newOwner)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpgrade(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        code: Cell,
        value = toNano('0.1'),
    ) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body: beginCell()
                .storeUint(Op.upgrade, 32)
                .storeUint(queryId, 64)
                .storeRef(code)
                .endCell(),
        });
    }

    async sendUpdateSignerThreshold(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        newThreshold: number,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_signer_threshold, 32)
            .storeUint(queryId, 64)
            .storeUint(newThreshold, 8)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdateSourcesThreshold(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        newThreshold: number,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_sources_threshold, 32)
            .storeUint(queryId, 64)
            .storeUint(newThreshold, 8)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdateMaxTimestampDelay(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        newDelay: bigint,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_max_timestamp_delay, 32)
            .storeUint(queryId, 64)
            .storeUint(newDelay, 64)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdateTrustedSigners(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        trustedSigners: Dictionary<bigint, boolean>,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_trusted_signers, 32)
            .storeUint(queryId, 64)
            .storeDict(trustedSigners)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdateCertificateTrustStore(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        certificateTrustStore: Dictionary<bigint, boolean>,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_certificate_trust_store, 32)
            .storeUint(queryId, 64)
            .storeDict(certificateTrustStore)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdateRequestHash(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        assetIndex: number,
        requestHash: bigint,
        isAdded: boolean,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_request_hash, 32)
            .storeUint(queryId, 64)
            .storeUint(assetIndex, 8)
            .storeUint(requestHash, 256)
            .storeUint(isAdded ? 1 : 0, 1)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async sendUpdatePrice(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        assetIndex: number,
        signatures: Dictionary<bigint, Buffer>,
        dataToSign: Slice,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.update_price, 32)
            .storeUint(queryId, 64)
            .storeUint(assetIndex, 8)
            .storeDict(signatures)
            .storeSlice(dataToSign)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    static packDataToSign(
        timestamp: bigint,
        requestHash: bigint,
        price: bigint,
        certificates: Dictionary<bigint, boolean>,
    ): Cell {
        return beginCell()
            .storeUint(timestamp, 64)
            .storeUint(requestHash, 256)
            .storeCoins(price)
            .storeDict(certificates)
            .endCell();
    }

    static packSignatures(
        signaturesData: SignatureData[],
    ): Dictionary<bigint, Buffer> {
        let dict = Dictionary.empty(
            Dictionary.Keys.BigUint(256),
            signatureDataDictionaryValue,
        );

        for (let item of signaturesData) {
            dict = dict.set(item.pk, item.sig);
        }

        return dict;
    }

    static packCertificates(
        certificates: bigint[],
    ): Dictionary<bigint, boolean> {
        let dict: Dictionary<bigint, boolean> = Dictionary.empty(
            Dictionary.Keys.BigUint(256),
            Dictionary.Values.Bool(),
        );
        for (let i = 0; i < certificates.length; i++) {
            dict = dict.set(certificates[i], true);
        }
        return dict;
    }
    static packPriceRecords(
        priceRecords: {
            assetIndex: number;
            requestHash: bigint;
            timestamp: bigint;
            price: bigint;
        }[],
    ): Dictionary<number, PriceRecord> {
        let dict: Dictionary<number, PriceRecord> = Dictionary.empty(
            Dictionary.Keys.Uint(8),
            priceRecordDictionaryValue,
        );
        for (let i = 0; i < priceRecords.length; i++) {
            const priceRecord = priceRecords[i];
            dict = dict.set(priceRecord.assetIndex, {
                requestHash: priceRecord.requestHash,
                timestamp: priceRecord.timestamp,
                price: priceRecord.price,
            });
        }
        return dict;
    }

    static packTrustedSigners(
        signersPk: bigint[],
    ): Dictionary<bigint, boolean> {
        let dict: Dictionary<bigint, boolean> = Dictionary.empty(
            Dictionary.Keys.BigUint(256),
            Dictionary.Values.Bool(),
        );
        for (let i = 0; i < signersPk.length; i++) {
            dict = dict.set(signersPk[i], true);
        }
        return dict;
    }

    async sendSendPrice(
        provider: ContractProvider,
        via: Sender,
        queryId: bigint,
        receiverAddress: Address,
        value = toNano('0.1'),
    ) {
        const body = beginCell()
            .storeUint(Op.send_price, 32)
            .storeUint(queryId, 64)
            .storeAddress(receiverAddress)
            .endCell();

        await provider.internal(via, {
            value,
            sendMode: SendMode.NONE,
            body,
        });
    }

    async getPriceRecordHash(provider: ContractProvider, data: Cell) {
        const result = await provider.get('get_price_record_hash', [
            {
                type: 'slice',
                cell: data,
            },
        ]);

        return result.stack.readBigNumber();
    }

    async getOracleData(provider: ContractProvider): Promise<OracleConfig> {
        const result = await provider.get('get_oracle_data', []);
        return {
            ownerAddress: result.stack.readAddress(),
            validSignersThreshold: result.stack.readNumber(),
            validSourcesThreshold: result.stack.readNumber(),
            maxTimestampDelay: result.stack.readNumber(),
            trustedSigners: Dictionary.loadDirect(
                Dictionary.Keys.BigUint(256),
                Dictionary.Values.Bool(),
                result.stack.readCellOpt(),
            ),
            certificateTrustStore: Dictionary.loadDirect(
                Dictionary.Keys.BigUint(256),
                Dictionary.Values.Bool(),
                result.stack.readCellOpt(),
            ),
            priceRecords: Dictionary.loadDirect(
                Dictionary.Keys.Uint(8),
                priceRecordDictionaryValue,
                result.stack.readCellOpt(),
            ),
        };
    }

    async getIsSignatureValid(
        provider: ContractProvider,
        dataHash: bigint,
        signature: Buffer,
        publicKey: bigint,
    ) {
        const result = await provider.get('get_is_signature_valid', [
            { type: 'int', value: dataHash },
            {
                type: 'slice',
                cell: beginCell().storeBuffer(signature).endCell(),
            },
            { type: 'int', value: publicKey },
        ]);

        return result.stack.readBoolean();
    }
}

export interface SignatureData {
    pk: bigint;
    sig: Buffer;
}

export interface PriceRecord {
    requestHash: bigint;
    timestamp: bigint;
    price: bigint;
}

export const signatureDataDictionaryValue: DictionaryValue<Buffer> = {
    serialize: function (src: Buffer, builder: Builder) {
        builder.storeBuffer(src);
    },
    parse: function (src: Slice): Buffer {
        return src.loadBuffer(512);
    },
};

export const priceRecordDictionaryValue: DictionaryValue<PriceRecord> = {
    serialize: function (src: PriceRecord, builder: Builder) {
        builder
            .storeUint(src.requestHash, 256)
            .storeUint(src.timestamp, 64)
            .storeCoins(src.price);
    },
    parse: function (src: Slice): PriceRecord {
        return {
            requestHash: src.loadUintBig(256),
            timestamp: src.loadUintBig(64),
            price: src.loadCoins(),
        };
    },
};
