# Contracts Architecture

The Crouton Finance stable swap system is composed of the following smart contracts:

- **`Factory`**: The central contract responsible for deploying other system contracts and managing various system parameters.
- **`Vault` and `NativeVault`**: Contracts designed to store Jettons or TON assets, with one vault deployed per asset.
- **`Pool`**: Implements the core logic for token swaps and managing the liquidity pool's state. Additionally, it functions as the Jetton Master for LP tokens.
- **`LiquidityDeposit`**: A temporary intermediary contract created for each user during liquidity deposits.
- **`Oracle`**: A contract used in pools where token exchange rates are not constant, providing the necessary rate data.

---

# TLB Definitions

### Token

This is a helper TLB type used to describe a token, which can either be TON or a Jetton:

```TLB
token$00 jetton_master_address:MsgAddress = Token;
token$01 = Token;
```

### Swap

When a user initiates a token swap by sending Jettons to the `Vault` contract, the swap parameters are provided in the Jetton's `transfer_notification` payload, which follows this TLB structure:

```TLB
swap_params#_ recipient:MsgAddress deadline:uint64 success_payload:Maybe(^Cell) fail_payload:Maybe(^Cell) = SwapParams;
swap_step#_ pool:MsgAddress to_token:Token limit:(VarUInteger 16) next:Maybe(^SwapStep) = SwapStep;
initial_step#_ to_token:Token limit:(VarUInteger 16) next:Maybe(^SwapStep) = InitialStep;

swap_notification#0x278f5089
    query_id:uint64
    from_token:Token
    sender:MsgAddress
    amount:(VarUInteger 16)
    steps:^InitalStep
    params:^SwapParams
```

### Add liquidity

When a user contributes Jettons/TON to a liquidity pool via the `Vault` contract, the liquidity parameters are transmitted within the Jetton's `transfer_notification` payload. This payload adheres to the following TLB structure:

```TLB
add_liquidity_additional_params# expected_tokens_count:uint8 min_shares_out:(VarUInteger 16) = AddLiquidityAdditionalParams
add_liquidity_notification#0x406d7624 query_id:uint64
    token:Token amount:(VarUInteger 16)
    pool_address:MsgAddress owner_address:MsgAddress params:(^AddLiquidityAdditionalParams) = AddLiquidityNotificationMsgBody;
```

### Remove liquidity

Since the `Pool` contract also acts as a Jetton Master, it supports the `burn` message, which facilitates liquidity withdrawal from the pool.

According to the Jetton specification, the Jetton Master may support an optional `custom_payload` parameter in burn messages. Crouton Finance uses this field to specify additional withdrawal parameters, such as slippage control and whether liquidity should be withdrawn in a balanced manner or in a specific pooled token.

```TLB
amounts#_ amount:(VarUInteger 16) next_amount:Maybe(^SerializedAmounts) = SerializedAmounts
burn_payload_one_coin#0x861a37c9 token_index:uint8 min_amount_out:(VarUInteger16) = BurnCustomPayload
burn_payload_balanced#0xa3550282 min_amounts:SerializedAmounts = BurnCustomPayload
```
