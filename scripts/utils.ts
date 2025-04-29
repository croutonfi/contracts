import fs from 'fs';
import path from 'path';

import { Cell } from '@ton/core';

export type DeployState = {
    type: string;
    address: string;
    code: string;
    data: string;
    codeHash: string;
    dataHash: string;
    meta: string;
};

const DEPLOYS_PATH = path.join(
    __dirname,
    process.env.NETWORK === 'mainnet' ? '/mainnet-deploys' : '/deploys',
);

export function saveDeployState(
    contractName: string,
    address: string,
    code: Cell = Cell.EMPTY,
    data: Cell = Cell.EMPTY,
    meta?: string,
) {
    const codeBoc = code.toBoc();
    const dataBoc = data.toBoc();

    const deployState: DeployState = {
        type: contractName,
        address,
        code: codeBoc.toString('base64'),
        data: dataBoc.toString('base64'),
        codeHash: code.hash().toString('hex'),
        dataHash: data.hash().toString('hex'),
        meta: meta || '',
    };

    const filename = `${contractName}_${address}.json`;
    const statePath = path.join(DEPLOYS_PATH, filename);

    if (!fs.existsSync(DEPLOYS_PATH)) {
        fs.mkdirSync(DEPLOYS_PATH);
    }

    fs.writeFileSync(statePath, JSON.stringify(deployState, null, 4));
}

export function createDeployStateIfNotExists(
    contractName: string,
    address: string,
    code: Cell = Cell.EMPTY,
    data: Cell = Cell.EMPTY,
    meta?: string,
) {
    const filename = `${contractName}_${address}.json`;
    const statePath = path.join(DEPLOYS_PATH, filename);

    if (!fs.existsSync(statePath)) {
        saveDeployState(contractName, address, code, data, meta);
    }
}

export function matchDeployFiles(contractName: string) {
    const files = fs.readdirSync(DEPLOYS_PATH);

    return files
        .filter((file) => file.includes(contractName + '_'))
        .map(
            (file) =>
                [
                    file,
                    JSON.parse(
                        fs.readFileSync(path.join(DEPLOYS_PATH, file), 'utf-8'),
                    ) as DeployState,
                ] as const,
        );
}
