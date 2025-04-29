import { NetworkProvider } from '@ton/blueprint';
import { toNano } from '@ton/core';
import { OracleCode } from '../compilables';
import { Oracle } from '../wrappers/Oracle';
import { createDeployStateIfNotExists, saveDeployState } from './utils';

export async function run(provider: NetworkProvider) {
    const ownerAddress = provider.sender().address;

    if (!ownerAddress) {
        throw new Error('Owner address is not defined');
    }

    const trustedSigners = Oracle.packTrustedSigners([
        BigInt(
            '0x03c1404c7c0f6de3af68dd946c4db3a8cf3c8ccb649467777fb445702b4f2c5a6e',
        ),
        BigInt(
            '0x0321c87f74d73fc0db030e190619223b8e62bc4f6f777468af5c36d1a0e6e93684',
        ),
        BigInt(
            '0x02979d9a6bd5a576e604fb1fabbf773634ef223d9e4801c83402f02ed89b7bb02f',
        ),
    ]);

    const certificateTrustStore = Oracle.packCertificates([
        BigInt(
            '0x53dd4bfb790452cc5ab98476322744eddf7a4f910a2d8ad505f7d0c232057d97', // DEDUST
        ),
        BigInt(
            '0x25705cf98a614bc5c0d45900adeda84383cea33ed824ea9ce5ed65f3f18e167b', // STON
        ),
        BigInt(
            '0xdb8fa0f22276770963cef09b3ca58bb954d634d7d5e979ee2fcb730115a6d87c', // ONCHAIN
        ),
    ]);

    const priceRecords = Oracle.packPriceRecords([
        {
            assetIndex: 0, // TON
            requestHash: 0n,
            timestamp: BigInt('0xffffffffffffffff'), // max timestamp
            price: 1_000_000_000n,
        },
        {
            assetIndex: 1,
            requestHash: BigInt(
                '0x04ffedb8c9d1d1716ac119e923db6a068e206342187040cbb7e8d668f34a82b9',
            ),
            timestamp: 0n,
            price: 0n,
        },
        {
            assetIndex: 2, // stTON
            requestHash: BigInt(
                '0x04ffedb8c9d1d1716ac119e923db6a068e206342187040cbb7e8d668f34a82b9',
            ),
            timestamp: 0n,
            price: 0n,
        },
    ]);

    const ui = provider.ui();
    const oracle = provider.open(
        Oracle.createFromConfig(
            {
                ownerAddress,
                validSignersThreshold: 2,
                validSourcesThreshold: 2,
                maxTimestampDelay: 12 * 60 * 60 * 1000, // 12 hours
                trustedSigners,
                certificateTrustStore,
                priceRecords,
            },
            await OracleCode,
        ),
    );

    if (await provider.isContractDeployed(oracle.address)) {
        ui.write(
            `Error: Contract at address ${oracle.address} is already deployed!`,
        );

        createDeployStateIfNotExists(
            'oracle',
            oracle.address.toString(),
            oracle.init?.code,
            oracle.init?.data,
        );
        return;
    }

    await oracle.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(oracle.address);

    ui.write(`Oracle deployed at address: ${oracle.address}`);

    saveDeployState(
        'oracle',
        oracle.address.toString(),
        oracle.init?.code,
        oracle.init?.data,
    );
}
