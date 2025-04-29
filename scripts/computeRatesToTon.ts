import { NetworkProvider } from '@ton/blueprint';
import BN from 'bignumber.js';

export async function run(provider: NetworkProvider) {
    const ui = provider.ui();
    const assetDecimals = BigInt(await ui.input('Enter asset decimals:'));
    const rateMultiplier = new BN(await ui.input('Enter rate multiplier:'));

    const base = 10n ** 18n;
    const one = 10n ** BigInt(assetDecimals);
    const precision = base / one;

    const result = {
        rate: new BN(base.toString())
            .times(precision.toString())
            .times(rateMultiplier)
            .integerValue(BN.ROUND_DOWN),
        precision,
        one,
    };

    ui.write(`Rate: ${result.rate.toFixed()}`);
    ui.write(`Precision: ${result.precision.toString()}`);
    ui.write(`One: ${result.one.toString()}`);
}
