import { NetworkProvider } from '@ton/blueprint';
import { BlankContractCode } from '../compilables';

export async function run(_: NetworkProvider) {
    const code = await BlankContractCode;

    console.log(code);
}
