import { Address, Builder, Slice, TupleReader } from '@ton/core';

export enum TokenType {
    Jetton = 0,
    Native = 1,
}

export type Token = {
    type: TokenType;
    jettonMasterAddress?: Address;
};

export const buildNativeToken = () => ({
    type: TokenType.Native,
});

export const buildJettonToken = (jettonMasterAddress: Address) => ({
    type: TokenType.Jetton,
    jettonMasterAddress,
});

export const storeNativeToken = (builder: Builder) => {
    return builder.storeUint(TokenType.Native, 2);
};

export const storeJettonToken =
    (jettonMasterAddress: Address) => (builder: Builder) => {
        return builder
            .storeUint(TokenType.Jetton, 2)
            .storeAddress(jettonMasterAddress);
    };

export const storeToken = (token: Token) => (builder: Builder) => {
    if (token.type === TokenType.Jetton) {
        return storeJettonToken(token.jettonMasterAddress!)(builder);
    } else if (token.type === TokenType.Native) {
        return storeNativeToken(builder);
    }

    throw new Error('Invalid token type');
};

export const loadToken = (slice: Slice): Token => {
    const tokenType = slice.loadUint(2);

    if (tokenType === TokenType.Jetton) {
        return {
            type: TokenType.Jetton,
            jettonMasterAddress: slice.loadAddress(),
        };
    } else if (tokenType === TokenType.Native) {
        return {
            type: TokenType.Native,
        };
    }

    throw new Error('Invalid token type');
};

export const readToken = (tuple: TupleReader): Token => {
    const item = tuple.pop();

    if (item.type !== 'slice') {
        throw new Error('Invalid item in tuple');
    }

    return loadToken(item.cell.beginParse());
};
