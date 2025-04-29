import { UIProvider } from '@ton/blueprint';
import {
    beginCell,
    Builder,
    Dictionary,
    DictionaryValue,
    Slice,
} from '@ton/core';
import { sha256 } from '@ton/crypto';

export const ContentValue: DictionaryValue<string> = {
    serialize: (src: string, builder: Builder) => {
        builder.storeRef(
            beginCell().storeUint(0, 8).storeStringTail(src).endCell(),
        );
    },
    parse: (src: Slice) => {
        const sc = src.loadRef().beginParse();
        const prefix = sc.loadUint(8);

        if (prefix == 0) {
            return sc.loadStringTail();
        } else {
            throw new Error('Unsupported content value type');
        }
    },
};

export async function promptJettonContent(ui: UIProvider) {
    const testJettonName =
        (await ui.input('Enter TestJetton name (default=TestJetton):')) ||
        'TestJetton';

    const testJettonSymbol =
        (await ui.input('Enter TestJetton symbol (default=TJ):')) || 'TJ';

    const testJettonDecimals =
        (await ui.input('Enter TestJetton decimals (default=9):')) || '9';

    const testJettonImage =
        (await ui.input(
            'Enter TestJetton image (default=smiley from wiki):',
        )) ||
        'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Smiley.svg/440px-Smiley.svg.png';

    const testJettonDescription =
        (await ui.input(
            'Enter TestJetton description (default=TestJetton Token):',
        )) || 'TestJetton Token';

    const content = {
        name: testJettonName,
        symbol: testJettonSymbol,
        decimals: testJettonDecimals,
        image: testJettonImage,
        description: testJettonDescription,
    };

    const encodedContent = Dictionary.empty(
        Dictionary.Keys.BigUint(256),
        ContentValue,
    );
    for (const [key, value] of Object.entries(content)) {
        encodedContent.set(
            BigInt('0x' + (await sha256(key)).toString('hex')),
            value,
        );
    }

    return {
        content,
        encodedContent: beginCell()
            .storeUint(0, 8)
            .storeDict(encodedContent)
            .endCell(),
    };
}
