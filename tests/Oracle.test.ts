import { compile } from '@ton/blueprint';
import { beginCell, Cell, Dictionary, toNano } from '@ton/core';
import { KeyPair, sign } from '@ton/crypto';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { Errors } from '../wrappers/constants';
import { Oracle, priceRecordDictionaryValue } from '../wrappers/Oracle';
import { getKeyPair } from './helpers/oracle';

describe('Oracle', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Oracle');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let oracle: SandboxContract<Oracle>;
    let user: SandboxContract<TreasuryContract>;
    let requestHash: bigint = BigInt(
        '0xc2de2d100713916e430670d8bcfde6b7d1878473b46b0efde659f19a8bde6822',
    );
    let signerAKeyPair: KeyPair;
    let signerBKeyPair: KeyPair;
    let trustedCertificates: bigint[] = [
        BigInt(
            '0x25705cf98a614bc5c0d45900adeda84383cea33ed824ea9ce5ed65f3f18e167b',
        ),
        BigInt(
            '0xdb8fa0f22276770963cef09b3ca58bb954d634d7d5e979ee2fcb730115a6d87c',
        ),
        BigInt(
            '0x53dd4bfb790452cc5ab98476322744eddf7a4f910a2d8ad505f7d0c232057d97',
        ),
    ];

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        user = await blockchain.treasury('user');
        signerAKeyPair = await getKeyPair(Buffer.from('signerA'));
        signerBKeyPair = await getKeyPair(Buffer.from('signerB'));

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
            requestHash: requestHash,
            timestamp: 0n,
            price: 0n,
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
                code,
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
    });

    it('should check signature', async () => {
        const buffer = Buffer.from(
            'b5ee9c724101060100a6000159000001932bd3223cc2de2d100713916e430670d8bcfde6b7d1878473b46b0efde659f19a8bde682243e247029c01020120020502012003040043bfa5705cf98a614bc5c0d45900adeda84383cea33ed824ea9ce5ed65f3f18e167bc00043bf93dd4bfb790452cc5ab98476322744eddf7a4f910a2d8ad505f7d0c232057d97c00043bfedc7d079113b3b84b1e7784d9e52c5dcaa6b1a6beaf4bcf717e5b9808ad36c3e60d9197b57',
            'hex',
        );
        const dataHash = Cell.fromBoc(buffer)[0].hash();
        const signature = Buffer.from(
            '16f5697800436aa7ce3b0403d2c49a606ae4ac7c5d6427ef76bcbd422fbfbd35910d329b2e891f8568683dae6bee88e14b091b7c75bfaf8f342f4f7f2c73e506',
            'hex',
        );
        const publicKey = BigInt(
            '0xefe3dc983001d9955310c52307848739100a2067115172d462bb7d0c148d2886',
        );
        const isSignatureValid = await oracle.getIsSignatureValid(
            BigInt('0x' + dataHash.toString('hex')),
            signature,
            publicKey,
        );
        expect(isSignatureValid).toBe(true);
    });

    describe('update price record', () => {
        it('should update price record', async () => {
            const timestamp = BigInt(Date.now());
            const price = 500n;
            const assetIndex = 1;
            const dataToSign = Oracle.packDataToSign(
                timestamp,
                requestHash,
                price,
                Oracle.packCertificates(trustedCertificates),
            );

            const sigA = sign(dataToSign.hash(), signerAKeyPair.secretKey);
            const sigB = sign(dataToSign.hash(), signerBKeyPair.secretKey);
            const signatures = Oracle.packSignatures([
                {
                    pk: BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                    sig: sigA,
                },
                {
                    pk: BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
                    sig: sigB,
                },
            ]);

            const updatePriceRecordResult = await oracle.sendUpdatePrice(
                user.getSender(),
                0n,
                assetIndex,
                signatures,
                dataToSign.beginParse(),
            );

            expect(updatePriceRecordResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: true,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord?.timestamp).toBe(timestamp);
            expect(priceRecord?.price).toBe(price);
            expect(priceRecord?.requestHash).toBe(requestHash);
        });
        it('should throw not enough valid signatures', async () => {
            const timestamp = BigInt(Date.now());
            const price = 500n;
            const assetIndex = 1;
            const dataToSign = Oracle.packDataToSign(
                timestamp,
                requestHash,
                price,
                Oracle.packCertificates(trustedCertificates),
            );

            const fakeDataToSign = beginCell().storeUint(1n, 64).endCell();

            const sigA = sign(fakeDataToSign.hash(), signerAKeyPair.secretKey);
            const sigB = sign(fakeDataToSign.hash(), signerBKeyPair.secretKey);
            const signatures = Oracle.packSignatures([
                {
                    pk: BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                    sig: sigA,
                },
                {
                    pk: BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
                    sig: sigB,
                },
            ]);

            const oracleDataBefore = await oracle.getOracleData();
            const priceRecordBefore =
                oracleDataBefore.priceRecords.get(assetIndex);
            const updatePriceRecordResult = await oracle.sendUpdatePrice(
                user.getSender(),
                0n,
                assetIndex,
                signatures,
                dataToSign.beginParse(),
            );

            expect(updatePriceRecordResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.insufficient_signatures,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord?.timestamp).toBe(priceRecordBefore?.timestamp);
            expect(priceRecord?.requestHash).toBe(
                priceRecordBefore?.requestHash,
            );
            expect(priceRecord?.price).toBe(priceRecordBefore?.price);
        });
        it('should throw not enough signatures for the threshold', async () => {
            const timestamp = BigInt(Date.now());
            const price = 1000n;
            const assetIndex = 1;
            const dataToSign = Oracle.packDataToSign(
                timestamp,
                requestHash,
                price,
                Oracle.packCertificates(trustedCertificates),
            );

            const sigA = sign(dataToSign.hash(), signerAKeyPair.secretKey);
            const signatures = Oracle.packSignatures([
                {
                    pk: BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                    sig: sigA,
                },
            ]);

            const oracleDataBefore = await oracle.getOracleData();
            const priceRecordBefore =
                oracleDataBefore.priceRecords.get(assetIndex);
            const updatePriceRecordResult = await oracle.sendUpdatePrice(
                user.getSender(),
                0n,
                assetIndex,
                signatures,
                dataToSign.beginParse(),
            );

            expect(updatePriceRecordResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.insufficient_signatures,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord?.timestamp).toBe(priceRecordBefore?.timestamp);
            expect(priceRecord?.price).toBe(priceRecordBefore?.price);
            expect(priceRecord?.requestHash).toBe(
                priceRecordBefore?.requestHash,
            );
        });
        it('should throw not enough valid sources', async () => {
            const timestamp = BigInt(Date.now());
            const price = 1000n;
            const assetIndex = 1;
            const dataToSign = Oracle.packDataToSign(
                timestamp,
                requestHash,
                price,
                Oracle.packCertificates([44n]),
            );

            const sigA = sign(dataToSign.hash(), signerAKeyPair.secretKey);
            const sigB = sign(dataToSign.hash(), signerBKeyPair.secretKey);
            const signatures = Oracle.packSignatures([
                {
                    pk: BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                    sig: sigA,
                },
                {
                    pk: BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
                    sig: sigB,
                },
            ]);

            const oracleDataBefore = await oracle.getOracleData();
            const priceRecordBefore =
                oracleDataBefore.priceRecords.get(assetIndex);
            const updatePriceRecordResult = await oracle.sendUpdatePrice(
                user.getSender(),
                0n,
                assetIndex,
                signatures,
                dataToSign.beginParse(),
            );

            expect(updatePriceRecordResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.insufficient_sources,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord?.timestamp).toBe(priceRecordBefore?.timestamp);
            expect(priceRecord?.price).toBe(priceRecordBefore?.price);
            expect(priceRecord?.requestHash).toBe(
                priceRecordBefore?.requestHash,
            );
        });
        it('should throw invalid request hash', async () => {
            const timestamp = BigInt(Date.now());
            const price = 1000n;
            const assetIndex = 1;
            const fakeRequestHash = requestHash + 1n;
            const dataToSign = Oracle.packDataToSign(
                timestamp,
                fakeRequestHash,
                price,
                Oracle.packCertificates(trustedCertificates),
            );

            const sigA = sign(dataToSign.hash(), signerAKeyPair.secretKey);
            const sigB = sign(dataToSign.hash(), signerBKeyPair.secretKey);
            const signatures = Oracle.packSignatures([
                {
                    pk: BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                    sig: sigA,
                },
                {
                    pk: BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
                    sig: sigB,
                },
            ]);

            const oracleDataBefore = await oracle.getOracleData();
            const priceRecordBefore =
                oracleDataBefore.priceRecords.get(assetIndex);
            const updatePriceRecordResult = await oracle.sendUpdatePrice(
                user.getSender(),
                0n,
                assetIndex,
                signatures,
                dataToSign.beginParse(),
            );

            expect(updatePriceRecordResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.invalid_request_hash,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord?.price).toBe(priceRecordBefore?.price);
            expect(priceRecord?.timestamp).toBe(priceRecordBefore?.timestamp);
            expect(priceRecord?.requestHash).toBe(
                priceRecordBefore?.requestHash,
            );
        });
    });

    describe('update trusted certificates', () => {
        it('should update trusted certificates', async () => {
            const newTrustedCertificates = [1n, 2n];
            const updateTrustedCertificatesResult =
                await oracle.sendUpdateCertificateTrustStore(
                    deployer.getSender(),
                    0n,
                    Oracle.packCertificates(newTrustedCertificates),
                );

            expect(
                updateTrustedCertificatesResult.transactions,
            ).toHaveTransaction({
                from: deployer.address,
                to: oracle.address,
                success: true,
            });

            const oracleData = await oracle.getOracleData();
            expect(oracleData.certificateTrustStore.keys()).toEqual(
                newTrustedCertificates,
            );
        });

        it('should throw invalid owner', async () => {
            const newTrustedCertificates = [1n, 2n, 44n];
            const updateTrustedCertificatesResult =
                await oracle.sendUpdateCertificateTrustStore(
                    user.getSender(),
                    0n,
                    Oracle.packCertificates(newTrustedCertificates),
                );

            expect(
                updateTrustedCertificatesResult.transactions,
            ).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.wrong_op,
            });
        });
    });

    describe('update trusted signers', () => {
        it('should update trusted signers', async () => {
            const newTrustedSigners = [
                BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
            ];
            const updateTrustedSignersResult =
                await oracle.sendUpdateTrustedSigners(
                    deployer.getSender(),
                    0n,
                    Oracle.packTrustedSigners(newTrustedSigners),
                );

            expect(updateTrustedSignersResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: oracle.address,
                success: true,
            });

            const oracleData = await oracle.getOracleData();
            expect(oracleData.trustedSigners.keys()).toEqual(newTrustedSigners);
        });

        it('should throw invalid owner', async () => {
            const newTrustedSigners = [
                BigInt('0x' + signerAKeyPair.publicKey.toString('hex')),
                BigInt('0x' + signerBKeyPair.publicKey.toString('hex')),
            ];
            const updateTrustedSignersResult =
                await oracle.sendUpdateTrustedSigners(
                    user.getSender(),
                    0n,
                    Oracle.packTrustedSigners(newTrustedSigners),
                );

            expect(updateTrustedSignersResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.wrong_op,
            });
        });
    });

    describe('update certificates threshold', () => {
        it('should update sources threshold', async () => {
            const newSourcesThreshold = 2;
            const updateSourcesThresholdResult =
                await oracle.sendUpdateSourcesThreshold(
                    deployer.getSender(),
                    0n,
                    newSourcesThreshold,
                );

            expect(updateSourcesThresholdResult.transactions).toHaveTransaction(
                {
                    from: deployer.address,
                    to: oracle.address,
                    success: true,
                },
            );

            const oracleData = await oracle.getOracleData();
            expect(oracleData.validSourcesThreshold).toBe(newSourcesThreshold);
        });

        it('should throw invalid owner', async () => {
            const updateSourcesThresholdResult =
                await oracle.sendUpdateSourcesThreshold(
                    user.getSender(),
                    0n,
                    2,
                );

            expect(updateSourcesThresholdResult.transactions).toHaveTransaction(
                {
                    from: user.address,
                    to: oracle.address,
                    success: false,
                    exitCode: Errors.wrong_op,
                },
            );
        });
    });

    describe('update signers threshold', () => {
        it('should update signers threshold', async () => {
            const newSignersThreshold = 1;
            const updateSignersThresholdResult =
                await oracle.sendUpdateSignerThreshold(
                    deployer.getSender(),
                    0n,
                    newSignersThreshold,
                );

            expect(updateSignersThresholdResult.transactions).toHaveTransaction(
                {
                    from: deployer.address,
                    to: oracle.address,
                    success: true,
                },
            );

            const oracleData = await oracle.getOracleData();
            expect(oracleData.validSignersThreshold).toBe(newSignersThreshold);
        });

        it('should throw invalid owner', async () => {
            const updateSignersThresholdResult =
                await oracle.sendUpdateSignerThreshold(user.getSender(), 0n, 2);

            expect(updateSignersThresholdResult.transactions).toHaveTransaction(
                {
                    from: user.address,
                    to: oracle.address,
                    success: false,
                    exitCode: Errors.wrong_op,
                },
            );
        });
    });

    describe('update request hash', () => {
        it('should update request hash', async () => {
            const newRequestHash = 1n;
            const assetIndex = 2;
            const updateRequestHashResult = await oracle.sendUpdateRequestHash(
                deployer.getSender(),
                0n,
                assetIndex,
                newRequestHash,
                true,
            );

            expect(updateRequestHashResult.transactions).toHaveTransaction({
                from: deployer.address,
                to: oracle.address,
                success: true,
            });

            const oracleData = await oracle.getOracleData();
            const priceRecord = oracleData.priceRecords.get(assetIndex);
            expect(priceRecord).toBeDefined();
        });

        it('should throw invalid owner', async () => {
            const assetIndex = 3;
            const updateRequestHashResult = await oracle.sendUpdateRequestHash(
                user.getSender(),
                0n,
                assetIndex,
                2n,
                true,
            );

            expect(updateRequestHashResult.transactions).toHaveTransaction({
                from: user.address,
                to: oracle.address,
                success: false,
                exitCode: Errors.wrong_op,
            });
        });
    });
});
