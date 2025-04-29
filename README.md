[![test](https://github.com/croutonfi/core/actions/workflows/test.yml/badge.svg)](https://github.com/croutonfi/core/actions/workflows/test.yml)

---

# Crouton Core


**Crouton Core** is a collection of FunC smart contracts that power Crouton's Stableswap AMM on the TON blockchain.

![640x360](https://github.com/user-attachments/assets/daa5c3f0-0c3e-4cf3-b31e-eaf5734a21a4)

## Audit

The Crouton contracts have been audited by Quantstamp. You can read the full audit report here: [certificate](https://certificate.quantstamp.com/full/crouton-finance-stable-swap/14a85512-535f-4145-bbe9-1069ef8ce9a9).

*The version of the contract code matches the GitHub commit `3e00046d9aa6266e51c6e11a114426e421eee9fc` from the original repository.*

## Prerequisites

Before getting started, make sure you have the following installed:

-   **Node.js**: v20.15.1

## Running Tests

To run all the test suites, use the following command:

```bash
npm test
```

If you want to run a specific test suite, use:

```bash
npm test <test-suite-name>
```

## Scripts

This repository includes several useful scripts for deploying, upgrading, and managing the core smart contracts. These scripts are located in the `/scripts` directory and can be executed using the [Blueprint CLI](https://www.npmjs.com/package/blueprint).

Example of deploying a smart contract:

```bash
npx blueprint run --mnemonic deploy3TONPool
```

### Setting Up Environment Variables

Before running any script, ensure that you have created a `.env` file with the appropriate environment variables. Here’s an example:

```env
WALLET_MNEMONIC=test test test...
WALLET_VERSION=v4
NETWORK=testnet # or mainnet
```
