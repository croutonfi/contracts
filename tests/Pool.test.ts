import { beginCell, Cell, Dictionary, toNano } from '@ton/core';
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import {
    BlankContractCode,
    JettonVaultCode,
    MockContractCode,
    OracleCode,
    PoolCode,
} from '../compilables';
import { JettonWallet } from '../wrappers';
import {
    buildChangeContentMsg,
    buildStopUpdateAMessage,
    buildUpdateAMessage,
    buildUpdateFeesMessage,
    buildUpdateRatesManagerMessage,
    buildUpdateRatesMessage,
    buildUpgradeMessage,
    buildWithdrawAdminFeesMessage,
} from '../wrappers/admin';
import { ContractType } from '../wrappers/common';
import {
    Errors,
    MAX_A,
    MAX_A_CHANGE,
    MAX_ADMIN_FEE,
    MAX_FEE,
    Op,
} from '../wrappers/constants';
import { JettonMaster } from '../wrappers/jetton/JettonMaster';
import { MockContract } from '../wrappers/MockContract';
import { Oracle, priceRecordDictionaryValue } from '../wrappers/Oracle';
import {
    Asset,
    deserealizeAssetsFromCell,
    deserializeRatesFromCell,
    Pool,
} from '../wrappers/Pool';
import { buildJettonToken, buildNativeToken } from '../wrappers/tokens';
import { Vault } from '../wrappers/Vault';
import { deployJettonMaster } from './helpers/jettons';
import { getKeyPair } from './helpers/oracle';
import { createJettonAsset, createRates } from './helpers/pools';
import { addJettonLiquidity } from './helpers/vaults';

describe('Pool', () => {
    const A = 100n;
    const FEE = 100n;
    const ADMIN_FEE = 100n;

    let deployer: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;

    let pool: SandboxContract<Pool>;
    let vault: SandboxContract<Vault>;

    // dummy
    let jettonMaster: SandboxContract<JettonMaster>;

    beforeAll(async () => {
        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user');

        jettonMaster = await deployJettonMaster('jettonMaster');

        vault = blockchain.openContract(
            Vault.createFromConfig(
                {
                    factoryAddress: deployer.address,
                    token: buildJettonToken(jettonMaster.address),
                },
                await BlankContractCode,
                await JettonVaultCode,
            ),
        );

        const result = await vault.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
        );

        expect(result.transactions).toHaveTransaction({
            to: vault.address,
            deploy: true,
            success: true,
        });

        // one real jetton and two dummy jettons
        const assets: Asset[] = [
            jettonMaster,
            ...(await blockchain.createWallets(2)),
        ].map((contract) => createJettonAsset(contract));

        pool = blockchain.openContract(
            Pool.createFromConfig(
                {
                    factoryAddress: deployer.address,
                    assets,
                    A,
                },
                await BlankContractCode,
                await PoolCode,
            ),
        );

        const poolResult = await pool.sendDeploy(
            deployer.getSender(),
            toNano('0.05'),
            {
                initialA: A,
                fee: FEE,
                adminFee: ADMIN_FEE,
                rates: createRates(assets.length),
                sharesWalletCode: await BlankContractCode,
                content: beginCell().endCell(),
                ratesManager: deployer.address,
            },
        );

        expect(poolResult.transactions).toHaveTransaction({
            to: pool.address,
            deploy: true,
            success: true,
        });

        expect(poolResult.transactions).toHaveTransaction({
            from: pool.address,
            to: pool.address,
            op: Op.init_pool,
            success: true,
        });
    });

    describe('init', () => {
        it('should be deployed and initialized correctly', async () => {
            const {
                factoryAddress,
                contractType,
                assets: assetsCell,
                rates: ratesCell,
                A: amplifier,
                fee,
                adminFee,
                totalSupply,
                ratesManager,
            } = await pool.getPoolData();

            expect(factoryAddress).toEqualAddress(deployer.address);
            expect(contractType).toEqual(ContractType.Pool);
            expect(amplifier).toEqual(A);
            expect(fee).toEqual(FEE);
            expect(adminFee).toEqual(ADMIN_FEE);
            expect(totalSupply).toEqual(0n);
            expect(ratesManager).toEqualAddress(deployer.address);

            const assets = deserealizeAssetsFromCell(assetsCell);
            expect(assets.length).toEqual(3);

            const rates = deserializeRatesFromCell(ratesCell);
            expect(rates.length).toEqual(3);
        });
    });

    describe('admin actions', () => {
        describe('content update', () => {
            it('should be able to update content', async () => {
                const newContent = beginCell().storeUint(4242, 32).endCell();

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildChangeContentMsg(newContent),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.change_content,
                    success: true,
                });

                const { content } = await pool.getJettonData();

                expect(content.hash()).toEqual(newContent.hash());
            });

            it('should throw if not called by factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildChangeContentMsg(Cell.EMPTY),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    op: Op.change_content,
                    exitCode: Errors.caller_not_authorized,
                    success: false,
                });
            });
        });

        describe('fees update', () => {
            it('should be able to update fees', async () => {
                const newFee = 142n;
                const newAdminFee = 242n;

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateFeesMessage(newFee, newAdminFee),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_fees,
                    success: true,
                });

                const { fee, adminFee } = await pool.getPoolData();

                expect(fee).toEqual(newFee);
                expect(adminFee).toEqual(newAdminFee);
            });

            it('should throw if fee is above limit', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateFeesMessage(MAX_FEE + 1n, 0n),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_fees,
                    exitCode: Errors.invalid_fee,
                    success: false,
                });
            });

            it('should throw if admin_fee is above limit', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateFeesMessage(0n, MAX_ADMIN_FEE + 1n),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_fees,
                    exitCode: Errors.invalid_fee,
                    success: false,
                });
            });

            it('should throw if not called by factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildUpdateFeesMessage(0n, 0n),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    op: Op.update_fees,
                    exitCode: Errors.caller_not_authorized,
                    success: false,
                });
            });
        });

        describe('A (amplifier) update', () => {
            it('should be able to increase A', async () => {
                const newA = 200n;
                const newATime = now + 3600;

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(newA, newATime),
                );
                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    success: true,
                });
                blockchain.now = now + 1800;
                const { A: A_mid } = await pool.getPoolData();

                expect(A_mid).toEqual(150n);

                blockchain.now = newATime;
                const { A: A_final } = await pool.getPoolData();

                expect(A_final).toEqual(newA);
            });

            it('should be able to decrease A', async () => {
                const newA = 50n;
                const newATime = now + 3600;

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(newA, newATime),
                );
                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    success: true,
                });

                blockchain.now = now + 1800;
                const { A: A_mid } = await pool.getPoolData();

                expect(A_mid).toEqual(75n);

                blockchain.now = newATime;
                const { A: A_final } = await pool.getPoolData();

                expect(A_final).toEqual(newA);
            });

            it('should throw if A greater than MAX_A', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(MAX_A + 1n, now + 3600),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    exitCode: Errors.invalid_A,
                    success: false,
                });
            });

            it('should throw if A_time is in the past', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(200n, now - 1),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    exitCode: Errors.invalid_A_future_time,
                    success: false,
                });
            });

            it('should throw if A increased more times then MAX_A_CHANGE', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(A * MAX_A_CHANGE + 1n, now + 3600),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    exitCode: Errors.invalid_A,
                    success: false,
                });
            });

            it('should throw if A decreased more times then MAX_A_CHANGE', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(A / MAX_A_CHANGE - 1n, now + 3600),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_A,
                    exitCode: Errors.invalid_A,
                    success: false,
                });
            });

            it('should throw if not called by factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildUpdateAMessage(200n, now + 3600),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    op: Op.update_A,
                    exitCode: Errors.caller_not_authorized,
                    success: false,
                });
            });
        });

        describe('Stop update A', () => {
            it('should be able to stop A update', async () => {
                await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateAMessage(200n, now + 3600),
                );

                blockchain.now = now + 1800;

                const { A: A_mid } = await pool.getPoolData();
                expect(A_mid).toEqual(150n);

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildStopUpdateAMessage(),
                );
                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.stop_update_A,
                    success: true,
                });

                const { A: A_final } = await pool.getPoolData();
                expect(A_final).toEqual(A_mid);

                blockchain.now = now + 3600 * 2;

                const { A: A_final_later } = await pool.getPoolData();

                expect(A_final_later).toEqual(A_mid);
            });

            it('should throw if not called by factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildStopUpdateAMessage(),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    op: Op.stop_update_A,
                    exitCode: Errors.caller_not_authorized,
                    success: false,
                });
            });
        });

        describe('is able to update rates manager', () => {
            it('should be able to update rates manager', async () => {
                const newRatesManager =
                    await blockchain.treasury('newRatesManager');

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateRatesManagerMessage(newRatesManager.address),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_rates_manager,
                    success: true,
                });

                const { ratesManager } = await pool.getPoolData();

                expect(ratesManager).toEqualAddress(newRatesManager.address);
            });

            it('should throw if not called by factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildUpdateRatesManagerMessage(user.address),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.caller_not_authorized,
                });
            });
        });

        describe('is able to update rates', () => {
            it('should be able to update rates', async () => {
                const newRates = createRates(3).map((rate) => rate * 2n);
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateRatesMessage(newRates),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.update_rates,
                    success: true,
                });

                const { rates: ratesDict } = await pool.getPoolData();
                const rates = deserializeRatesFromCell(ratesDict);

                expect(rates).toEqual(newRates);
            });

            it('should throw if not called by rates manager', async () => {
                const newRates = createRates(3).map((rate) => rate * 2n);
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildUpdateRatesMessage(newRates),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.caller_not_authorized,
                });
            });

            it('should throw if rates length is not equal to n_coins', async () => {
                const newRates = createRates(2);
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpdateRatesMessage(newRates),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.invalid_rates,
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

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpgradeMessage(newCode, dummyInitMessage),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.upgrade,
                    success: true,
                });

                expect(result.transactions).toHaveTransaction({
                    from: pool.address,
                    to: pool.address,
                    op: Op.initialize,
                    success: true,
                    body: dummyInitMessage,
                });

                const mockContract = blockchain.openContract(
                    await MockContract.createFromAddress(pool.address),
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

                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildUpgradeMessage(newCode),
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: pool.address,
                    op: Op.upgrade,
                    success: true,
                });

                const mockContract = blockchain.openContract(
                    await MockContract.createFromAddress(pool.address),
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

                const result = await pool.sendMessage(
                    user.getSender(),
                    buildUpgradeMessage(Cell.EMPTY),
                );

                expect(result.transactions).toHaveTransaction({
                    from: user.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.caller_not_authorized,
                });
            });
        });

        describe('withdraw admin fees', () => {
            let assets: Asset[];

            beforeAll(async () => {
                assets = [
                    jettonMaster,
                    ...(await blockchain.createWallets(2)),
                ].map((contract) => createJettonAsset(contract));

                assets[0].adminFees = toNano('1000');

                pool = blockchain.openContract(
                    Pool.createFromConfig(
                        {
                            factoryAddress: deployer.address,
                            assets,
                            A,
                        },
                        await BlankContractCode,
                        await PoolCode,
                    ),
                );

                const poolResult = await pool.sendDeploy(
                    deployer.getSender(),
                    toNano('0.05'),
                    {
                        initialA: A,
                        fee: FEE,
                        adminFee: ADMIN_FEE,
                        rates: createRates(assets.length),
                        sharesWalletCode: await BlankContractCode,
                        content: beginCell().endCell(),
                        ratesManager: deployer.address,
                    },
                );

                expect(poolResult.transactions).toHaveTransaction({
                    to: pool.address,
                    deploy: true,
                    success: true,
                });

                expect(poolResult.transactions).toHaveTransaction({
                    from: pool.address,
                    to: pool.address,
                    op: Op.init_pool,
                    success: true,
                });
            });

            it('should be able to withdraw admin fees', async () => {
                const amount = toNano('1000');
                await jettonMaster.sendMint(
                    deployer.getSender(),
                    user.address,
                    amount,
                    toNano('0.025'),
                    toNano('0.05'),
                );
                const wallet = blockchain.openContract(
                    JettonWallet.createFromAddress(
                        await jettonMaster.getWalletAddress(user.address),
                    ),
                );

                await addJettonLiquidity(vault, wallet, amount, pool, user);

                const receiver = await blockchain.treasury('receiver');
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildWithdrawAdminFeesMessage(
                        buildJettonToken(jettonMaster.address),
                        receiver.address,
                        amount,
                    ),
                );

                expect(result.transactions).toHaveTransaction({
                    from: pool.address,
                    to: vault.address,
                    op: Op.payout,
                });
            });

            it('should not send anything if amount is zero', async () => {
                const receiver = await blockchain.treasury('receiver');
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildWithdrawAdminFeesMessage(
                        buildJettonToken(jettonMaster.address),
                        receiver.address,
                        0n,
                    ),
                );

                expect(result.transactions).not.toHaveTransaction({
                    from: pool.address,
                    to: vault.address,
                    op: Op.payout,
                });
            });

            it('should not send anything if admin fee balance is less than amount', async () => {
                const amount = toNano('1000');
                await jettonMaster.sendMint(
                    deployer.getSender(),
                    user.address,
                    amount,
                    toNano('0.025'),
                    toNano('0.05'),
                );
                const wallet = blockchain.openContract(
                    JettonWallet.createFromAddress(
                        await jettonMaster.getWalletAddress(user.address),
                    ),
                );

                await addJettonLiquidity(vault, wallet, amount, pool, user);

                const receiver = await blockchain.treasury('receiver');
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildWithdrawAdminFeesMessage(
                        buildJettonToken(jettonMaster.address),
                        receiver.address,
                        amount + 1n,
                    ),
                );

                expect(result.transactions).not.toHaveTransaction({
                    from: pool.address,
                    to: vault.address,
                    op: Op.payout,
                });
            });

            it('should revert if token is not in pool', async () => {
                const result = await pool.sendMessage(
                    deployer.getSender(),
                    buildWithdrawAdminFeesMessage(
                        buildNativeToken(),
                        user.address,
                        42n,
                    ),
                );

                expect(result.transactions).toHaveTransaction({
                    op: Op.withdraw_admin_fees,
                    from: deployer.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.unknown_token,
                });
            });

            it('should reject if sender is not factory', async () => {
                const result = await pool.sendMessage(
                    user.getSender(),
                    buildWithdrawAdminFeesMessage(
                        buildJettonToken(jettonMaster.address),
                        user.address,
                        42n,
                    ),
                );

                expect(result.transactions).toHaveTransaction({
                    op: Op.withdraw_admin_fees,
                    from: user.address,
                    to: pool.address,
                    success: false,
                    exitCode: Errors.caller_not_authorized,
                });
            });
        });
    });

    describe('oracle', () => {
        let oracle: SandboxContract<Oracle>;

        beforeAll(async () => {
            let trustedCertificates: bigint[] = [
                BigInt(
                    '0xdb8fa0f22276770963cef09b3ca58bb954d634d7d5e979ee2fcb730115a6d87c',
                ),
                BigInt(
                    '0x53dd4bfb790452cc5ab98476322744eddf7a4f910a2d8ad505f7d0c232057d97',
                ),
            ];
            let signerAKeyPair = await getKeyPair(Buffer.from('signerA'));
            let signerBKeyPair = await getKeyPair(Buffer.from('signerB'));

            const trustedSigners = Oracle.packTrustedSigners([
                BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
            ]);

            const certificateTrustStore =
                Oracle.packCertificates(trustedCertificates);

            const priceRecords = Dictionary.empty(
                Dictionary.Keys.Uint(8),
                priceRecordDictionaryValue,
            );
            priceRecords.set(0, {
                requestHash: 0n,
                timestamp: 18446744073709551615n, // max uint64
                price: 1000000000n,
            });
            priceRecords.set(1, {
                requestHash: 100n,
                timestamp: 18446744073709551615n,
                price: 1040000000n,
            });
            priceRecords.set(2, {
                requestHash: 140n,
                timestamp: 18446744073709551615n,
                price: 1050000000n,
            });

            oracle = blockchain.openContract(
                Oracle.createFromConfig(
                    {
                        ownerAddress: deployer.address,
                        validSignersThreshold: 2,
                        validSourcesThreshold: 1,
                        maxTimestampDelay: 2 * 60 * 1000,
                        trustedSigners,
                        certificateTrustStore,
                        priceRecords,
                    },
                    await OracleCode,
                ),
            );

            const deployResult = await oracle.sendDeploy(
                deployer.getSender(),
                toNano('0.05'),
            );

            expect(deployResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: oracle.address,
                deploy: true,
                success: true,
            });

            const result = await pool.sendMessage(
                deployer.getSender(),
                buildUpdateRatesManagerMessage(oracle.address),
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                op: Op.update_rates_manager,
                success: true,
            });

            const { ratesManager } = await pool.getPoolData();

            expect(ratesManager).toEqualAddress(oracle.address);
        });
        it('should be able to update rates', async () => {
            const updateSendPriceResult = await oracle.sendSendPrice(
                user.getSender(),
                0n,
                pool.address,
            );

            expect(updateSendPriceResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                op: Op.send_price,
                success: true,
            });
            expect(updateSendPriceResult.transactions).toHaveTransaction({
                from: oracle.address,
                to: pool.address,
                op: Op.update_rates,
                success: true,
            });

            const { rates: ratesDict } = await pool.getPoolData();
            const rates = deserializeRatesFromCell(ratesDict);

            expect(rates).toEqual([1000000000n, 1040000000n, 1050000000n]);
        });
    });
});
