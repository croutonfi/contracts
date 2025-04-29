import { Address } from '@ton/core';

export const ZERO_ADDRESS = new Address(0, Buffer.alloc(32, 0));

export const FEE_DENOMINATOR = 10000000000n;
export const PRECISION = 1000000000000000000n;

export const MAX_ADMIN_FEE = 10000000000n;
export const MAX_FEE = 5000000000n;

export const MAX_A = 1000000n;
export const MAX_A_CHANGE = 100n;

export const A_PRECISION = 100n;

export const Assets = {
    default_rate: 1000000000000000000n,
    default_precicion: 1000000000000000000n,
} as const;

export const PoolConfig = {
    default_A: 100n,
} as const;

export abstract class Op {
    // Jetton Wallet
    static transfer = 0xf8a7ea5;
    static transfer_notification = 0x7362d09c;
    static internal_transfer = 0x178d4519;

    static excesses = 0xd53276db;
    static burn = 0x595f07bc;
    static burn_notification = 0x7bdd97de;
    static withdraw_tons = 0x6d8e5e3c;
    static withdraw_jettons = 0x768a50b2;

    static provide_wallet_address = 0x2c76b973;
    static take_wallet_address = 0xd1735400;

    // Jetton master
    static mint = 0x1674b0a0;
    static change_admin = 0x4840664f;
    static change_content = 0x5773d1f5;

    // Blank contract
    static initialize = 0xbe5a7595;

    // Vault
    static init_vault = 0x4990564c;
    static payout = 0xd4374956;
    static add_liquidity = 0x406d7624;
    static swap = 0x25938561;

    // Pool
    static init_pool = 0x69a3f9b9;
    static update_reserves = 0xe8824c87;
    static swap_notification = 0x278f5089;
    static remove_liquidity_one_coin = 0x861a37c9; // used "burn" custom_payload
    static remove_liquidity_balanced = 0xa3550282; // used "burn" custom_payload
    static update_fees = 0xf74a44af;
    static update_A = 0xb2a96dab;
    static stop_update_A = 0x600df564;
    static update_rates_manager = 0x1a5d8162;
    static update_rates = 0x60f90a44;
    static withdraw_admin_fees = 0x9f50769f;
    static peer_swap = 0xaf51b44b;

    // Factory
    static deploy_vault = 0x89ed7fbb;
    static deploy_pool = 0xaee6a3c6;
    static add_liquidity_notification = 0x5845cd8b;
    static transfer_ownership = 0x295e75a9;
    static update_code = 0x20ccb55b;
    static admin_action = 0x785a1566;

    // Liquidity Deposit
    static deposit_notification = 0xa6589976;
    static deposit_all = 0x6f875dec;
    static carry_remaining_balance = 0x77536c2e;

    // Oracle
    static update_signer_threshold = 0xad71dfe3;
    static update_sources_threshold = 0x211e2908;
    static update_max_timestamp_delay = 0x376071e0;
    static update_trusted_signers = 0xe1ef9751;
    static update_certificate_trust_store = 0xad0192b6;
    static update_request_hash = 0xbd8e229e;
    static update_price = 0xaaacc05b;
    static send_price = 0xaf15cdc2;

    // Upgrade
    static upgrade = 0xdbfaf817;

    // Mock contract
    static forward_msg = 0x0b43b0b3;

    static getOpByCode(code: number): string | undefined {
        for (const [key, val] of Object.entries(Op)) {
            if (val === code) {
                return key;
            }
        }
        return undefined;
    }
}

export abstract class Errors {
    // generic
    static wrong_workchain = 333;
    static wrong_op = 0xffff;
    static unknown_asset_type = 404;
    static unauthorized = 403;
    static caller_not_authorized = 405;

    // jetton wallet errors
    static unauthorized_transfer = 705;
    static not_enough_jettons = 706;
    static unauthorized_incoming_transfer = 707;
    static malformed_forward_payload = 708;
    static not_enough_ton = 709;
    static burn_fee_not_matched = 710;
    static unknown_action_bounced = 0xfff0;

    // jetton minter errors
    static unauthorized_mint_request = 73;
    static unouthorized_burn = 74;
    static unauthorized_change_admin_request = 76;
    static unauthorized_change_content_request = 77;

    // liquidity deposit
    static no_tokens_deposited = 140;

    // Pool errors
    static unknown_token = 160;
    static output_is_less_than_min_out = 161;
    static deadline_exceeded = 162;
    static not_initialized = 163;
    static invariant_is_less_than_expected = 164;
    static wrong_amounts = 165;
    static invalid_token_index = 166;
    static invalid_fee = 167;
    static invalid_A = 168;
    static invalid_A_future_time = 169;
    static invalid_rates = 170;

    // math errors
    static convergence_did_not_occur = 101;
    static same_coins_provided = 102;
    static index_below_zero = 103;
    static index_above_n_coins = 104;

    // oracle errors
    static insufficient_signatures = 200;
    static invalid_request_hash = 201;
    static insufficient_sources = 202;
    static prices_expired = 203;
    static invalid_asset_index = 204;
}
