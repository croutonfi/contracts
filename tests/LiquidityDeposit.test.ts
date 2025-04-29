import { beginCell, Cell, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { MockContractCode } from '../compilables';
import { buildUpgradeMessage } from '../wrappers/admin';
import { ContractType } from '../wrappers/common';
import { Errors, Op } from '../wrappers/constants';
import { JettonMaster } from '../wrappers/jetton/JettonMaster';
import { LiquidityDeposit } from '../wrappers/LiquidityDeposit';
import { MockContract } from '../wrappers/MockContract';
import { buildJettonToken, readToken } from '../wrappers/tokens';
import { deployJettonMaster } from './helpers/jettons';
import { createLiquidityDeposit } from './helpers/liquidity_deposit';

describe('LiquidtyDeposit', () => {
    let jettonMaster: SandboxContract<JettonMaster>;
    let jettonMaster2: SandboxContract<JettonMaster>;
    let jettonMaster3: SandboxContract<JettonMaster>;

    let deployer: SandboxContract<TreasuryContract>;

    let pool: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;

    let liquidityDeposit: SandboxContract<LiquidityDeposit>;

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');
        pool = await blockchain.treasury('pool');
        owner = await blockchain.treasury('owner');

        jettonMaster = await deployJettonMaster();
        jettonMaster2 = await deployJettonMaster();
        jettonMaster3 = await deployJettonMaster();

        liquidityDeposit = blockchain.openContract(
            await createLiquidityDeposit(deployer, owner, pool),
        );

        const deploymentResult = await liquidityDeposit.sendDeploy(
            deployer.getSender(),
            toNano('0.1'),
        );

        expect(deploymentResult.transactions).toHaveTransaction({
            to: liquidityDeposit.address,
            deploy: true,
        });
    });

    describe('init', () => {
        it('should be deployed correctly with jetton_wallet_address set', async () => {
            const [
                factoryAddress,
                contractType,
                ownerAddress,
                poolAddress,
                jettons,
                balances,
            ] = await liquidityDeposit.getLiquidityDepositData();

            expect(factoryAddress).toEqualAddress(deployer.address);
            expect(contractType).toEqual(ContractType.LiquidityDeposit);
            expect(ownerAddress).toEqualAddress(owner.address);
            expect(poolAddress).toEqualAddress(pool.address);
        });
    });

    describe('deposit', () => {
        it('should be able to increase a certain balance', async () => {
            const amount = toNano('42');

            const result = await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
            );

            expect(result.transactions).toHaveTransaction({
                to: liquidityDeposit.address,
                op: Op.deposit_notification,
                success: true,
            });

            const [, , , , tokens, balances] =
                await liquidityDeposit.getLiquidityDepositData();

            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(balances.readBigNumber()).toEqual(amount);
        });

        it('should throw a unauthorized error if the initialize/deposit_notification comes not from factory', async () => {
            const result = await liquidityDeposit.sendDepositNotification(
                owner.getSender(),
                buildJettonToken(jettonMaster.address),
                toNano('10'),
            );

            expect(result.transactions).toHaveTransaction({
                to: liquidityDeposit.address,
                op: Op.initialize,
                success: false,
                exitCode: Errors.unauthorized,
            });
        });

        it('should be able to increase a certain balance multiple times with multiple tokens', async () => {
            const amount = toNano('42');

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
            );
            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
            );

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster2.address),
                amount,
            );
            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster3.address),
                amount,
            );

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster2.address),
                amount,
            );

            const [, , , , tokens, balances] =
                await liquidityDeposit.getLiquidityDepositData();

            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster2.address,
            );
            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster3.address,
            );

            expect(balances.readBigNumber()).toEqual(amount * 2n);
            expect(balances.readBigNumber()).toEqual(amount * 2n);
            expect(balances.readBigNumber()).toEqual(amount);
        });

        it('should be able to increase a certain balance multiple times with multiple tokens', async () => {
            const amount = toNano('42');

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
            );
            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster2.address),
                amount,
            );
            const [, , , , tokens, balances] =
                await liquidityDeposit.getLiquidityDepositData();

            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster.address,
            );
            expect(readToken(tokens).jettonMasterAddress).toEqualAddress(
                jettonMaster2.address,
            );

            expect(balances.readBigNumber()).toEqual(amount);
            expect(balances.readBigNumber()).toEqual(amount);

            const result = await liquidityDeposit.sendDepositAll(
                owner.getSender(),
            );

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });
        });

        it('should be able to automatically send update_reserves when expected_tokens_count is achieved', async () => {
            const amount = toNano('42');
            const expectedTokensCount = 2;

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
                expectedTokensCount,
            );

            const result = await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster2.address),
                amount,
                expectedTokensCount,
            );
            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: liquidityDeposit.address,
                endStatus: 'non-existing',
            });

            expect(result.transactions).not.toHaveTransaction({
                success: false,
            });
            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });
        });

        it('should be able to finalise "stuck" deposits by sending a new transaction', async () => {
            const amount = toNano('42');

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
                2, // sending only one token while expecting two
            );

            const result = await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster2.address),
                amount,
                1, // just sending the another token once to finalise 'stuck' deposit
            );

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: liquidityDeposit.address,
                endStatus: 'non-existing',
            });

            expect(result.transactions).not.toHaveTransaction({
                success: false,
            });

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: pool.address,
                op: Op.update_reserves,
                success: true,
            });
        });

        it('should return unauthoirzed error if sender is not owner for deposit_all', async () => {
            const amount = toNano('42');

            await liquidityDeposit.sendDepositNotification(
                deployer.getSender(),
                buildJettonToken(jettonMaster.address),
                amount,
            );
            const result = await liquidityDeposit.sendDepositAll(
                deployer.getSender(),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: liquidityDeposit.address,
                op: Op.deposit_all,
                success: false,
                exitCode: Errors.unauthorized,
            });
        });

        it('should return no_tokens_deposited error if there were no tokens deposited', async () => {
            const result = await liquidityDeposit.sendDepositAll(
                owner.getSender(),
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: liquidityDeposit.address,
                op: Op.deposit_all,
                success: false,
                exitCode: Errors.no_tokens_deposited,
            });
        });
    });

    describe('upgrade', () => {
        it('should be able to upgrade', async () => {
            const newCode = await MockContractCode;

            const dummyInitMessage = beginCell()
                .storeUint(Op.initialize, 32)
                .storeUint(0, 64)
                .endCell();

            const result = await liquidityDeposit.sendMessage(
                deployer.getSender(),
                buildUpgradeMessage(newCode, dummyInitMessage),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: liquidityDeposit.address,
                op: Op.upgrade,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                from: liquidityDeposit.address,
                to: liquidityDeposit.address,
                op: Op.initialize,
                success: true,
                body: dummyInitMessage,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(liquidityDeposit.address),
            );
            const { state } = await mockContract.getState();

            if (state.type !== 'active') {
                throw new Error('State is not active');
            }
            const actualCode = Cell.fromBoc(state.code!)[0];

            expect(actualCode.hash()).toEqual(newCode.hash());
        });

        it('should be able to upgrade with empty fwd msg', async () => {
            const newCode = await MockContractCode;

            const result = await liquidityDeposit.sendMessage(
                deployer.getSender(),
                buildUpgradeMessage(newCode),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: liquidityDeposit.address,
                op: Op.upgrade,
                success: true,
            });

            const mockContract = blockchain.openContract(
                await MockContract.createFromAddress(liquidityDeposit.address),
            );
            const { state } = await mockContract.getState();

            if (state.type !== 'active') {
                throw new Error('State is not active');
            }
            const actualCode = Cell.fromBoc(state.code!)[0];

            expect(actualCode.hash()).toEqual(newCode.hash());
        });

        it('should throw if sender is not factory', async () => {
            const user = await blockchain.treasury('user');

            const result = await liquidityDeposit.sendMessage(
                user.getSender(),
                buildUpgradeMessage(Cell.EMPTY),
            );

            expect(result.transactions).toHaveTransaction({
                from: user.address,
                to: liquidityDeposit.address,
                success: false,
                exitCode: Errors.caller_not_authorized,
            });
        });
    });
});
