import { SandboxContract } from '@ton/sandbox';
import { LiquidityDeposit} from '../../wrappers/LiquidityDeposit';
import { Contract } from '@ton/core';
import { BlankContractCode, LiquidityDepositCode } from '../../compilables';

export async function createLiquidityDeposit(
    factory: SandboxContract<Contract>,
    user: SandboxContract<Contract>,
    pool: SandboxContract<Contract>,
) {
    return LiquidityDeposit.createFromConfig(
        {
            factoryAddress: factory.address,
            ownerAddress: user.address,
            poolAddress: pool.address,
        },
        await BlankContractCode,
        await LiquidityDepositCode,
    );
}
