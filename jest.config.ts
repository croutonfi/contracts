import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    workerThreads: true,
    testTimeout: 10000,
    setupFilesAfterEnv: ['./tests/setup/jest.setup.ts']
};

export default config;
