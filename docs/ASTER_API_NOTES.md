# Aster API notes

Verified 2026-11-14 against the official docs and live public endpoints. Nothing in this file came from an authenticated call. No API key, signer key, or wallet was used.

When a doc and a live response disagree, both are recorded. Endpoints that were not in the official futures reference are not treated as supported, even if a probe happened to answer.

## Sources

Primary, in the order this desk should trust them:

| Source | What it is |
| --- | --- |
| [asterdex/api-docs README](https://github.com/asterdex/api-docs/blob/master/README.md) | Official index. Says new work should use V3. States that new V1 API keys stopped on 2026-03-25, and that authenticated V3 calls require a prior deposit from 2026-09-01. |
| [Futures API V3 (EN)](https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-v3.md) | Canonical mainnet futures/perps reference. Raw file fetched this session. |
| [Futures Testnet API V3 (EN)](https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-testnet.md) | Same surface, testnet hosts and testnet signing domain. |
| [Aster API Overview](https://github.com/asterdex/api-docs/blob/master/Aster%20API%20Overview.md) | V1 vs V3 comparison. Its signing summary conflicts with the code sample in the futures reference. See open questions. |
| [CHANGELOG](https://github.com/asterdex/api-docs/blob/master/CHANGELOG.md) | Latest entry reviewed: 2026-11-09. Deposit rule dated 2026-08-31, effective 2026-09-01. |
| [Deposit and withdrawal demo](https://github.com/asterdex/api-docs/blob/master/demo/aster-deposit-withdrawal.md) | Deposit chains, vault addresses, and withdraw signatures. |
| [Aster Chain RPC](https://github.com/asterdex/api-docs/blob/master/RPC/aster-chain-rpc.md) | Public JSON-RPC reads of balances and positions at `https://tapi.asterdex.com/info`. Not the trading API. |
| [docs.asterdex.com API page](https://docs.asterdex.com/for-developers/aster-api/api-documentation) | Still documents **V1** HMAC (`/fapi/v1`, `X-MBX-APIKEY`). Useful for the old model. Not the integration this desk should build. |
| [V3 general info mirror](https://asterdex.github.io/aster-api-website/futures-v3/general-info/) | Website render of the V3 reference. |
| [asterCode authentication](https://asterdex.github.io/aster-api-website/asterCode/authentication/) and [endpoints](https://asterdex.github.io/aster-api-website/asterCode/endpoints/) | Builder-oriented pages. They describe `POST /fapi/v3/approveAgent` with a different typed-data shape than `registerAndApproveAgent` in the futures reference. Treat as a conflicting secondary source. |
| [asterdex/API-demo](https://github.com/asterdex/API-demo) | Example scripts. Not a supported SDK. |
| [asterdex/aster-connector-python](https://github.com/asterdex/aster-connector-python) | Official-looking Python package. It is an HMAC client (`Client(key, secret)`), which is the V1 model. |
| [asterdex/aster-mcp](https://github.com/asterdex/aster-mcp) | Community/official MCP server that implements both HMAC and V3 EIP-712. Not a dependency for this desk. |
| [asterdex/aster-broker-pro-sdk](https://github.com/asterdex/aster-broker-pro-sdk) | Embeddable broker UI. It is not an API client for our agents. Its README names BSC, ETH, SOL, and ARB, which matches the deposit docs. |

Agent creation UI linked from the futures reference: [https://www.asterdex.com/en/api-wallet](https://www.asterdex.com/en/api-wallet) (switch to Pro API). Testnet: [https://www.asterdex-testnet.com/en/api-wallet](https://www.asterdex-testnet.com/en/api-wallet).

## What was verified live

From this environment on 2026-11-14, unauthenticated:

| Call | Result |
| --- | --- |
| `GET https://fapi.asterdex.com/fapi/v3/ping` | `200` `{}` |
| `GET https://fapi.asterdex.com/fapi/v3/time` | `200` `{"serverTime":1794663038208}` with `X-MBX-USED-WEIGHT-1M: 1`. Date header `Sat, 14 Nov 2026 13:30:38 GMT`. |
| `GET https://fapi.asterdex.com/fapi/v3/exchangeInfo` | `200`, about 886 KB. See summary below. |
| `GET https://fapi.asterdex.com/fapi/v1/ping` and `/fapi/v1/time` | `200`. V1 public market routes still answer. Authenticated V1 was not tested. |
| `GET https://fapi.asterdex-testnet.com/fapi/v3/ping` and `/time` | `200`. |
| `GET https://sapi.asterdex.com/api/v3/ping` and `/api/v1/ping` | `200`. Spot exists. This desk does not trade spot. |
| `GET https://fapi3.asterdex.com/fapi/v3/ping` | `403` HTML. That host appears only in the order code sample. Do not use it. |
| `GET https://fapi5.asterdex.com/fapi/v3/time` | TLS handshake timed out. That host appears in the deposit demo's time example. Do not use it. |
| `wss://fstream.asterdex.com/ws/btcusdt@markPrice` | `101`, one `markPriceUpdate` frame. |
| `wss://fstream.asterdex.com/stream?streams=btcusdt@markPrice` | `101`, wrapped `{"stream","data"}`. |
| `wss://fstream.asterdex-testnet.com/ws/btcusdt@markPrice` | `101`. |
| `wss://fstream5.asterdex-testnet.com/ws/btcusdt@markPrice` | `101`. Both testnet socket hosts answered. Prefer the one in the user-data section: `fstream.asterdex-testnet.com`. |

Re-run with `python3 scripts/verify_aster_public.py`.

## Networks and chains

Trading perps is not an on-chain swap on Ethereum, BSC, Arbitrum, or Solana. The futures API is a hosted matching API. The EIP-712 domain for **trade** signatures is Aster's own chain id, not the deposit chain:

- Mainnet trade domain `chainId` **1666**, name `AsterSignTransaction`, version `1`, verifying contract the zero address. Source: order example in the [futures V3 reference](https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-v3.md).
- Testnet trade domain `chainId` **714**, same name and version. Source: the same example in the [testnet reference](https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-testnet.md).

Deposits move assets from a public chain into the Aster account. From the [deposit demo](https://github.com/asterdex/api-docs/blob/master/demo/aster-deposit-withdrawal.md), `depositFor(..., broker)` with `broker = 1000` credits **spot**. Any other `broker` credits **futures**. Direct ERC-20 transfers to the vault credit the sending address.

Vaults named in that demo:

| Chain | chainId | Vault |
| --- | --- | --- |
| ETH | 1 | `0x604DD02d620633Ae427888d41bfd15e38483736E` |
| BSC | 56 | `0x128463A60784c4D3f46c23Af3f65Ed859Ba87974` |
| Arbitrum | 42161 | `0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5` |

Solana deposits use program `EhUtRgu9iEbZXXRpEvDj6n1wnQRjMi2SERDo3c6bmN2c`. chainId in the withdraw examples is **101**. A plain transfer to the vault is not credited; the program methods are required.

SUI is documented as **spot only**, via a per-user deposit address from `GET https://sapi.asterdex.com/api/v3/aster/user-deposit-address?network=SUI`. A public asset query on 2026-11-14 (`chainIds=131&networks=SUI&accountType=spot`) returned `success: true` and an empty asset list. SUI is out of scope.

Live deposit-asset query, `GET https://www.asterdex.com/bapi/futures/v1/public/future/aster/deposit/assets`, 2026-11-14, all `code: "000000"`:

| Query | Assets returned |
| --- | --- |
| `chainIds=56&networks=EVM&accountType=perp` | 24, including USDT, USDC, USD1, BTC, ETH, BNB, ASTER |
| `chainIds=1&networks=EVM&accountType=perp` | ETH, U, USD1, USDC, USDT |
| `chainIds=42161&networks=EVM&accountType=perp` | ETH, USDC, USDCE, USDT |
| `chainIds=101&networks=SOLANA&accountType=perp` | JLP, SOL, USD1, USDC, USDT |
| `chainIds=56&networks=EVM&accountType=spot` | 78 assets |

This desk does not send deposits or withdrawals. The user funds the Aster futures account in Aster's own interface. MetaMask's ETH/BNB balance is not the trading balance.

The product behind `/fapi/v3` is USDT-margined perpetuals. Live `exchangeInfo` on 2026-11-14:

- `futuresType`: `U_MARGINED`
- `timezone`: `UTC`
- 644 symbols: 594 `TRADING`, 6 `PENDING_TRADING`, 44 `SETTLING`
- `contractType`: 638 `PERPETUAL`, 6 blank
- BTCUSDT and ETHUSDT: `status` `TRADING`, `contractType` `PERPETUAL`, `quoteAsset` and `marginAsset` `USDT`

There is no delivery-dated futures contract in that contract-type count. The spec's perpetuals requirement matches this API.

## Base URLs

| Use | URL | Status |
| --- | --- | --- |
| Futures REST, mainnet | `https://fapi.asterdex.com` | Documented and live |
| Futures market WebSocket, mainnet | `wss://fstream.asterdex.com` | Documented and live |
| Futures REST, testnet | `https://fapi.asterdex-testnet.com` | Documented and live |
| Futures market WebSocket, testnet | `wss://fstream.asterdex-testnet.com` | Documented in the user-data section and live. The market-stream section of the same testnet file also names `wss://fstream5.asterdex-testnet.com`, which also answered. |
| Spot REST | `https://sapi.asterdex.com` | Documented for spot. Ping verified. Not used for perps. |
| Spot WebSocket | `wss://sstream.asterdex.com` | Named by API-demo. Not probed. Not used. |
| Public chain read | `https://tapi.asterdex.com/info` | Documented JSON-RPC. Not probed with a real address. |
| Order-sample host `https://fapi3.asterdex.com` | — | 403 here. Ignore. |
| Deposit-demo time host `https://fapi5.asterdex.com` | — | Timed out. Ignore. |

Paths below are on the futures REST host unless noted.

## Authentication

Two models exist. New work uses the second.

### V1 HMAC, legacy

Documented on [docs.asterdex.com](https://docs.asterdex.com/for-developers/aster-api/api-documentation) and summarized in the [overview](https://github.com/asterdex/api-docs/blob/master/Aster%20API%20Overview.md):

- Header `X-MBX-APIKEY`
- `timestamp` in milliseconds, optional `recvWindow` (default 5000)
- HMAC SHA256 over the query string plus body, secret is the HMAC key
- Security types include NONE, TRADE, USER_DATA, USER_STREAM (key only), MARKET_DATA (key required on some routes)
- The same page says keys can be restricted to some secure routes, for example TRADE only, and that by default a key can access every secure route

The api-docs README says new V1 API key creation stopped on **2026-03-25**. Existing keys keep working. A [broker registration demo](https://github.com/asterdex/api-docs/blob/master/demo/aster-api-key-registration.md) still shows web login (`You are signing into Astherus <nonce>`, `chainId` 56) and `broker-create-api-key` returning `apiKey` and `apiSecret`. That demo conflicts with the README's "no new V1 keys" rule. This desk does not implement V1.

Public `/fapi/v1/...` market routes still return 200. That does not mean new HMAC keys can be created.

### V3 Pro API, the model to implement

From the futures V3 reference:

- The account is the user's wallet address (`user`).
- A separate API wallet, called the signer or agent, signs trade and user-data requests.
- The futures reference tells the reader to create that agent at the Pro API tab on `https://www.asterdex.com/en/api-wallet`.
- Signed requests carry `user`, `signer`, `nonce`, and `signature`.
- `nonce` is a microsecond timestamp. It must fall within 60 seconds before or after server time. Reuse is rejected. Each signer keeps the last 100 nonces.
- Optional `nonceWindow` (1–60000 ms) makes the sequencer drop the request if it is not processed by `nonce + nonceWindow`, error `-4227`. It is part of the signed string. It does not apply to read-only endpoints. Added in the changelog on 2026-11-06.
- Security types: NONE, TRADE, USER_DATA, USER_STREAM, MARKET_DATA (no auth), TRANSFER, WITHDRAW. TRADE, USER_DATA, and USER_STREAM need a signer and a signature. TRANSFER and WITHDRAW need a signer and a signature as well, and WITHDRAW flows add a separate user signature (below).

Trade signing, from the Python sample in the futures reference:

1. Build the parameter string (business fields plus `nonce` and `signer`).
2. EIP-712 domain: name `AsterSignTransaction`, version `1`, `chainId` 1666 on mainnet and 714 on testnet, verifying contract `0x0000000000000000000000000000000000000000`.
3. Primary type `Message` with one field `msg` (string), set to that parameter string **without** `signature`.
4. Sign with the **agent private key** (`eth_account` structured-data sign in the sample).
5. Send `signature` last. POST, PUT, and DELETE are documented as `application/x-www-form-urlencoded` bodies. The sample also shows the same bytes in the query string. GET uses the query string.

The sample sets a `user` variable and then does not append `user` to the order. The authentication table in the same document lists `user` as part of the signature payload. The deposit demo's V3 section also lists `user` as required. See open questions. The implementation should be ready to include `user` and should prove the exact string on testnet before mainnet.

The [overview](https://github.com/asterdex/api-docs/blob/master/Aster%20API%20Overview.md) describes a different procedure: sort keys, keccak, ECDSA. The code sample in the futures reference is EIP-712. Implement the code sample. Do not implement a second keccak path beside it.

There is a second conflict on nonce units. The futures reference says microseconds and shows `time.time() * 1_000_000` (16 digits, example `1748310859508867`). The deposit demo's "Pro API-KEY Signature" section says a nanosecond timestamp valid for 30 seconds, with an 19-digit example. For futures trading, follow the futures reference until a testnet call proves otherwise. The sample's `get_nonce()` also uses whole seconds times 1e6 plus a counter, which is not a true microsecond clock. Use a real microsecond clock and a lock so two requests never share a nonce.

### What the user signs in MetaMask, and what the server holds

Two different signatures:

1. **Trading authorization (once).** The user's main wallet signs an agent approval. The futures reference specifies `POST /fapi/v3/registerAndApproveAgent` (weight 50). The user signs with the **main wallet** private key, which stays inside MetaMask. The typed data is again `AsterSignTransaction` / `Message.msg`, but `domain.chainId` must be the request's `signatureChainId`: **56 for an EVM address, 101 for Solana**. The reference explicitly says not to use 1666 (and the testnet file says not to use 714) for this call. The message body is:

   `user={user}&nonce={nonce}&agentName={agentName}&agentAddress={agentAddress}&expired={expired}&signatureChainId={signatureChainId}&canSpotTrade={canSpotTrade}&canPerpTrade={canPerpTrade}&canWithdraw={canWithdraw}&ipWhitelist={ipWhitelist}`

   Flags we will send: `canPerpTrade=true`, `canSpotTrade=false`, `canWithdraw=false`. `ipWhitelist` is required only when `canWithdraw` is true. We still send a whitelist when the desk has a stable egress address. `expired` is milliseconds. The approval nonce must be within **10 seconds** of server time, which is tighter than the trade nonce. The endpoint is unauthenticated: no API key header. The reference says authorization is checked from the signature. It does not say whether this call costs gas. Do not describe it as gas-free until Aster says so.

2. **Every order and account read after that.** The desk signs with the **agent** private key, domain chainId 1666 (mainnet) or 714 (testnet). MetaMask is not prompted per order.

The desk generates the agent key itself and stores only that key. It never asks for the MetaMask seed or the MetaMask private key. MetaMask sees the approval typed data, not a trade, and never sees a withdraw typed data.

The website mirror [asterCode endpoints](https://asterdex.github.io/aster-api-website/asterCode/endpoints/) instead documents `POST /fapi/v3/approveAgent` with primary type `ApproveAgent`, and the authentication page on that site says management signatures use dynamic primary types while trades use `Message`. The futures markdown says `registerAndApproveAgent` is the combined call and is equivalent to registration plus `approveAgent`, but it does not paste a separate `approveAgent` schema. Those two write-ups are not the same payload. Stage 6 has to settle this on testnet. Until then, the futures markdown is the one we plan against.

No endpoint in the futures V3 reference returns the agent's `canWithdraw` flag. We can only know the flag because we built the approval. Accepting a pasted agent private key from the Aster website would not let us prove the flag. The design rejects pasted keys.

From **2026-09-01 00:00 UTC**, authenticated V3 account, order, and trade routes fail until the main wallet has deposited, with `{"code":-5050,"msg":"This function can only be used after deposit"}`. Agent-wallet and builder management routes, and public market data, are exempt. Source: README and changelog. Whether testnet enforces the same rule was not verified.

### Withdrawals can be refused

Yes, on V3, by the approval flag.

- `canWithdraw` is a required boolean on `registerAndApproveAgent`. `false` is a documented value. An empty `ipWhitelist` is forbidden only when `canWithdraw` is `true`.
- V1 docs say a key can be limited to TRADE routes. New V1 keys are discontinued, so that is not the plan.
- EVM futures withdraw is a further gate. `POST /fapi/v3/aster/user-withdraw` needs the V3 request signature **and** `userSignature`, an EIP-712 signature by the **user** wallet. Domain name `Aster` (not `AsterSignTransaction`), version `1`, chainId of the destination chain, primary type `Action` (`type=Withdraw`, destination, chain name, token, amount, fee, nonce, aster chain `Mainnet`). Chain names in that section: 1 ETH, 56 BSC, 42161 Arbitrum, 131 SUI. Source: the deposit/withdraw demo.
- Solana futures withdraw's `userSignature` is documented as not currently required. That is one more reason `canWithdraw` stays false. This desk is MetaMask (EVM) and will not call the Solana withdraw route.
- The futures reference also has `POST /fapi/v3/asset/migrateUser` (security WITHDRAW), signed by the source wallet, and the changelog describes `POST /aster-chain/v3/batch-transfer` (WITHDRAW). Futures/spot transfer is security type TRANSFER (`POST` transfer between futures and spot). Sub-account transfer exists too.

Whether `canPerpTrade=true` with `canWithdraw=false` still permits TRANSFER routes is **not stated**. The client will not call them. See the allowlist in the design.

Account responses include `canWithdraw` and `maxWithdrawAmount`. Those fields describe the **account**, not the agent. They must not be read as "this API credential can withdraw."

## Rate limits

Documented behavior (futures V3 reference):

- Limits come from `exchangeInfo.rateLimits`.
- HTTP 429 when a limit breaks. Back off. Repeating 429s can become HTTP 418, an IP ban, from 2 minutes up to 3 days.
- Request weight is counted per IP. Response header `X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter)`.
- Order count is counted per account. Header `X-MBX-ORDER-COUNT-(intervalNum)(intervalLetter)` on order responses. Rejected orders might omit it.
- HTTP 403 is a WAF limit. HTTP 503 means the result is **unknown**, not a failure. The client must query the order.

Documented example weights: request weight 2400 per minute, orders 1200 per minute.

Live mainnet `exchangeInfo` on 2026-11-14 also had a third limiter the example JSON does not show:

```json
[
  {"rateLimitType": "REQUEST_WEIGHT", "interval": "MINUTE", "intervalNum": 1, "limit": 2400},
  {"rateLimitType": "ORDERS", "interval": "MINUTE", "intervalNum": 1, "limit": 1200},
  {"rateLimitType": "ORDERS", "interval": "SECOND", "intervalNum": 10, "limit": 300}
]
```

So the live order cap is 1200 per minute and 300 per 10 seconds. Read the live array at startup. Do not hard-code only the two example objects.

Testnet `exchangeInfo` the same day:

```json
[
  {"rateLimitType": "REQUEST_WEIGHT", "interval": "MINUTE", "intervalNum": 1, "limit": -2},
  {"rateLimitType": "ORDERS", "interval": "MINUTE", "intervalNum": 1, "limit": -2},
  {"rateLimitType": "ORDERS", "interval": "SECOND", "intervalNum": 10, "limit": 1000}
]
```

What `-2` means is unverified. Do not assume the testnet is unlimited.

WebSocket (market and user streams):

- One connection lasts 24 hours, then the server drops it.
- Server ping every 5 minutes. No pong within 15 minutes closes the socket. Unsolicited pongs are allowed.
- 10 inbound messages per second. More than that drops the connection, and repeat offenders can be IP-banned.
- At most 200 streams per connection.
- The reference recommends user-data streams over REST for orders and positions during fast markets.

User stream `listenKey` lives 60 minutes. `POST /fapi/v3/listenKey` creates or refreshes it, `PUT` extends it, `DELETE` closes it. Events can arrive out of order; sort by `E`. The reference lists no business parameters, but the security type is USER_STREAM, which requires a signer and a signature. How an empty parameter list is signed was not verified.

Selected documented route weights used for planning: `premiumIndex` 1, `fundingRate` 1, `klines` 1 to 10 by limit, `depth` 2/5/10/20 by limit, `POST /fapi/v3/order` **0**, `GET /fapi/v3/account` 5, `GET /fapi/v3/positionRisk` 5, `GET /fapi/v3/income` 30, `POST /fapi/v3/placeStrategyOrder` 50, `POST /fapi/v3/leverage` 1. A single-symbol `GET /fapi/v3/ticker/24hr` is documented as weight 1; the live response header on one call was `X-MBX-USED-WEIGHT-1M: 2`. Trust the header at runtime.

## Market data

Public. No key.

| Method and path | Role | Live on 2026-11-14 |
| --- | --- | --- |
| `GET /fapi/v3/ping` | Connectivity | `{}` |
| `GET /fapi/v3/time` | Server time, milliseconds | See capture |
| `GET /fapi/v3/exchangeInfo` | Symbols, filters, rate limits | See summary |
| `GET /fapi/v3/depth?symbol&limit` | Book. Limits include 5, 10, 20, 50, 100, 500, 1000 | BTCUSDT limit 5 returned bids and asks |
| `GET /fapi/v3/trades?symbol&limit` | Recent trades | One BTCUSDT trade returned |
| `GET /fapi/v3/klines?symbol&interval&limit` | Candles. Intervals include 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M. Default limit 500, max 1500 | 5m BTCUSDT row matches the 12-field layout |
| `GET /fapi/v3/premiumIndex?symbol` | Mark, index, last funding rate, next funding time | BTCUSDT returned |
| `GET /fapi/v3/fundingRate?symbol&startTime&endTime&limit` | Funding history. Default 100, max 1000 | Two BTCUSDT rows returned with `limit=2` |
| `GET /fapi/v3/fundingInfo?symbol` | Funding interval and cap/floor | BTCUSDT interval 8 hours, cap 0.003, floor -0.003 |
| `GET /fapi/v3/ticker/price?symbol` | Last price | Returned |
| `GET /fapi/v3/ticker/24hr?symbol` | 24h stats | Returned. Live object had no `prevClosePrice`, which the doc example includes |
| `GET /fapi/v3/ticker/bookTicker?symbol` | Best bid/ask | Returned, plus `lastUpdateId` beyond the doc example |
| `GET /fapi/v3/markPriceKlines?symbol&interval&limit` | Mark-price candles | `200` for BTCUSDT 1h. The reference has a note saying this path was unverified and that only `marketKlines` existed. That note is stale as of this probe. |
| `GET /fapi/v3/indexPriceKlines?pair&interval&limit` | Index candles. Parameter name is `pair`, not `symbol` | `200` for `pair=BTCUSDT` |
| `GET /fapi/v3/marketKlines?symbol` | Mentioned only in that stale note | `symbol=BTCUSDT` and `symbol=BTCUSD` returned `-1121 Invalid symbol`. `pair=` returned `-1102` missing `symbol`. Do not use. |

`GET /fapi/v3/openInterest?symbol=BTCUSDT` returned `200` and a body during a probe. **It is not in the futures V3 reference.** Do not build on it.

Market streams, lowercase symbol, base `wss://fstream.asterdex.com`:

| Stream | Payload event |
| --- | --- |
| `<symbol>@markPrice` or `@markPrice@1s` | `markPriceUpdate` (mark, index, funding, next funding time) |
| `!markPrice@arr` or `!markPrice@arr@1s` | Array of the same |
| `<symbol>@kline_<interval>` | `kline` |
| `<symbol>@aggTrade` | `aggTrade` |
| `<symbol>@miniTicker`, `!miniTicker@arr` | `24hrMiniTicker` |
| `<symbol>@ticker`, `!ticker@arr` | `24hrTicker` |
| `<symbol>@bookTicker`, `!bookTicker` | `bookTicker` |
| `<symbol>@forceOrder`, `!forceOrder@arr` | `forceOrder` |
| `<symbol>@depth5`, `@depth10`, `@depth20`, with optional `@100ms` or `@500ms` | partial book |
| `<symbol>@depth` and the paced variants | diff book |

Raw URL `/ws/<stream>`. Combined URL `/stream?streams=<s1>/<s2>`. Subscribe later with `{"method":"SUBSCRIBE","params":[...],"id":1}`.

The spec's timeframes 5m, 15m, 1h, 4h, and 1d are all in the interval enum.

## Trading

All of these are `TRADE` and need the agent signature. Base path prefix `/fapi/v3`.

| Call | What it does |
| --- | --- |
| `POST /order` | New order. Weight documented as 0. |
| `PUT /order` | Modify a **LIMIT** order's quantity and price. Max 10000 modifications. Loses queue priority. |
| `DELETE /order` | Cancel one order. |
| `DELETE /allOpenOrders` | Cancel every open order on a symbol. |
| `POST /batchOrders` | Up to 5 orders. |
| `DELETE /batchOrders` | Cancel up to 10. |
| `POST /countdownCancelAll` | Dead-man's switch. Heartbeat with `countdownTime` in ms. `0` stops the timer. If the heartbeat stops, open orders on that symbol are canceled. It does not close positions. |
| `POST /leverage` | `symbol` and `leverage`. Documented range 1 to 125. The bracket for the symbol can be lower. Response includes `maxNotionalValue`. |
| `POST /marginType` | `ISOLATED` or `CROSSED`. |
| `POST /positionSide/dual` | `"true"` hedge mode, `"false"` one-way. Applies to **every** symbol. |
| `POST /positionMargin` | Add or remove isolated margin. |
| `POST /placeStrategyOrder` | OTO, OCO, or OTOCO. OTOCO is three legs. A rejection can be **HTTP 200** with `failureCode` set (documented example `-4142`). Callers must read `failureCode`. |
| `POST /chase` | Pegged post-only chase. Not required for the first execution stage. Changelog 2026-11-09 updated quote-quantity rounding. |

There is no `POST /closePosition`. Closing is an order:

- One-way mode (`positionSide` `BOTH`): opposite `side` with `reduceOnly=true`.
- Hedge mode: `positionSide` `LONG` or `SHORT` and the closing `side`. `reduceOnly` cannot be sent in hedge mode.
- `STOP_MARKET` or `TAKE_PROFIT_MARKET` with `closePosition=true` closes the whole side when triggered. Cannot be combined with `quantity` or `reduceOnly`.

Order types, confirmed by the enum and by live BTCUSDT `exchangeInfo`:

`LIMIT`, `MARKET`, `STOP`, `STOP_MARKET`, `TAKE_PROFIT`, `TAKE_PROFIT_MARKET`, `TRAILING_STOP_MARKET`.

Extra required fields:

| Type | Also required |
| --- | --- |
| `LIMIT` | `timeInForce`, `quantity`, `price` |
| `MARKET` | `quantity` |
| `STOP`, `TAKE_PROFIT` | `quantity`, `price`, `stopPrice` |
| `STOP_MARKET`, `TAKE_PROFIT_MARKET` | `stopPrice` |
| `TRAILING_STOP_MARKET` | `callbackRate` (min 0.1, max 5, where 1 means 1%) |

`workingType` is `MARK_PRICE` or `CONTRACT_PRICE` (default contract). `priceProtect=true` refuses the trigger when mark and contract diverge by more than the symbol's `triggerProtect`.

`timeInForce` on live BTCUSDT: `GTC`, `IOC`, `GTX` (post-only), `HIDDEN`. The V1 docs also list `FOK`. **V3 live exchange info does not list FOK.** Do not send FOK.

`newClientOrderId` matches `^[\.A-Z\:/a-z0-9_-]{1,36}$` and is unique among open orders. That is the idempotency handle. It is not a general request id that survives after the order is no longer open.

`newOrderRespType` `RESULT` returns the final state for a market order. Use it.

Position side:

- One-way: `BOTH`.
- Hedge: `LONG` or `SHORT`, and the field is required.

Trigger rules match the usual stop/take-profit split (stop buy triggers at or above `stopPrice`, take-profit buy at or below, and the reverse for sells).

Filters are per symbol. Use `exchangeInfo`, not the doc example. Live BTCUSDT on 2026-11-14:

- `PRICE_FILTER` tick `0.1`, min `1`, max `1000000`
- `LOT_SIZE` step `0.001`, min `0.001`, max `1000`
- `MARKET_LOT_SIZE` min `0.001`, max `120`
- `MIN_NOTIONAL` **5** (the doc example says 1)
- `MAX_NUM_ORDERS` 200
- `MAX_NUM_ALGO_ORDERS` **10** (the doc example says 100)
- `PERCENT_PRICE` multipliers 0.98 and 1.02

Algo orders are the stop, take-profit, and trailing types. A position with a stop and a take-profit consumes two of the ten algo slots.

Leverage 1–125 is the API field limit. `GET /fapi/v3/leverageBrackets` (USER_DATA) returns the notional bracket and the max initial leverage in that bracket. `GET /fapi/v3/leverageBracket` is the deprecated alias. `GET /fapi/v3/remainingOpenableNotionalValue` is a **symbol-level** open-interest cap at a leverage, not an account limit. Weight 50.

`POST /fapi/v3/order` does not size a position for you. Quantity is ours. Liquidation price is returned by `GET /fapi/v3/positionRisk`, not computed by a public quote endpoint.

## Account, positions, history

USER_DATA, agent signature:

| Call | Role |
| --- | --- |
| `GET /fapi/v3/balance` | Per-asset wallet, cross wallet, available, max withdraw amount. Weight 5. |
| `GET /fapi/v3/account` | Account totals, assets, and positions. The reference says this is the non-join-margin view. Weight 5. |
| `GET /fapi/v3/accountWithJoinMargin` | Join-margin view, same shape. Weight 5. |
| `GET /fapi/v3/positionRisk?symbol` | Entry, mark, liquidation, leverage, margin type, unrealized profit, notional, position amount, side. Weight 5. |
| `GET /fapi/v3/positionSide/dual` | Current hedge flag. Weight 30. |
| `GET /fapi/v3/openOrders?symbol` | Open orders. Weight 1 with symbol, 40 without. |
| `GET /fapi/v3/order` | One order. `orderId` or `origClientOrderId`. |
| `GET /fapi/v3/allOrders` | History. Window at most 7 days. Weight 5. Canceled or expired orders with no fill disappear after 7 days. |
| `GET /fapi/v3/userTrades?symbol` | Fills, commission, realized PnL. Window at most 7 days. Weight 5. |
| `GET /fapi/v3/income` | Ledger. `incomeType` includes `REALIZED_PNL`, `FUNDING_FEE`, `COMMISSION`, `TRANSFER`, `DEPOSIT`, `WITHDRAW`, and others. Weight 30. Default window 7 days. |
| `GET /fapi/v3/incomePage` | Same rows, paginated. Added 2026-10-22. |
| `GET /fapi/v3/commissionRate?symbol` | Maker and taker rates. Weight 20. |
| `GET /fapi/v3/leverageBrackets` | Brackets. |
| `GET /fapi/v3/adlQuantile` | ADL queue bucket 0–4. Weight 5. |
| `GET /fapi/v3/forceOrders` | Liquidation and ADL orders. |

Funding the account has paid is `income` with `incomeType=FUNDING_FEE`, not only the predicted rate on `premiumIndex`. Trading fees are `userTrades.commission` and `income` `COMMISSION`.

User-stream events on `wss://fstream.asterdex.com/ws/<listenKey>`:

- `ACCOUNT_UPDATE` balances and positions. Reason field includes `ORDER`, `FUNDING_FEE`, `DEPOSIT`, `WITHDRAW`.
- `ORDER_TRADE_UPDATE` order and fill state.
- `ACCOUNT_CONFIG_UPDATE` leverage and multi-asset mode.
- `MARGIN_CALL`
- `listenKeyExpired`

The reference says REST can lag in a fast market and tells clients to prefer these events.

Public RPC `aster_getBalance` on `https://tapi.asterdex.com/info` can return perp and spot balances and positions for an address, and it documents an account privacy flag. That read is not a substitute for the signed account endpoints: the documented position object omits liquidation price, leverage, and available margin. If privacy is off, another party who knows the address can read the public view. This desk will not rely on that RPC for trading state.

## Testnet

| Item | Value |
| --- | --- |
| REST | `https://fapi.asterdex-testnet.com` |
| WebSocket | `wss://fstream.asterdex-testnet.com` (also saw `fstream5` answer) |
| Agent UI | `https://www.asterdex-testnet.com/en/api-wallet` |
| Trade EIP-712 chainId | 714 |
| Approval `signatureChainId` for EVM | 56, and the testnet doc says not to put 714 in the approval domain |
| Symbols on 2026-11-14 | 18, including ASTERUSDT, BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT |
| `futuresType` | `U_MARGINED` |
| BTCUSDT premium index | Returned a mark, funding rate, and next funding time |

How a tester gets testnet margin is **not** in the futures testnet reference. That is an open question before any testnet order.

## SDKs

There is no maintained official TypeScript SDK for V3 signing in the repositories above.

- `aster-connector-python` speaks HMAC and `/fapi` V1-style methods. Do not wrap it for new orders.
- `API-demo` is a pile of examples, including `futures-v3-demo`. Useful as a reference, not as a library.
- `aster-mcp` can sign V3, and it also exposes transfers. We will not embed it. A compromised tool surface that includes withdraw and transfer is the wrong dependency.
- `aster-broker-pro-sdk` is a hosted trading widget for brokers. It does not give our agents a typed client.

The desk will own a small V3 signer and a typed client, with an allowlist of paths.

## What the spec asks for that this API does not do

| Spec | Fact | Closest supported path |
| --- | --- | --- |
| Each trade is a MetaMask transaction | Orders are HTTP requests signed by the agent key. MetaMask is not in the per-order path. | MetaMask signs the agent approval once. The agent key signs orders. |
| Wallet balance is trading capital | Trading capital is the Aster futures balance after a deposit. | Show the wallet balance as a separate labeled figure. Show `GET /fapi/v3/balance` and `account` as trading capital. |
| A scoped API key that cannot withdraw, created as a classic key/secret | New V1 keys are discontinued. V3 uses `canWithdraw`. | `registerAndApproveAgent` with `canWithdraw=false`, and never request `userSignature` for a withdraw. |
| One "close position" call | No such route. | Hedge-mode closing order, or one-way `reduceOnly`, or `closePosition=true` on a market stop/take-profit. |
| A single attach-bracket field on `POST /order` | Stops and targets are their own orders. | Send `STOP_MARKET` and `TAKE_PROFIT_MARKET` after the entry, or one `OTOCO` strategy order once separate orders are proven. |
| FOK | Not in the V3 time-in-force enum, and not on live BTCUSDT. | IOC, or a limit with GTC. |
| Guaranteed leverage 125 | 125 is the field maximum. Brackets lower it. | Read `leverageBrackets` and cap by the desk maximum. |
| Server-side position sizing and R:R | The API takes a quantity. | Size in our risk code. |
| Exchange-side kill switch that flattens positions when our process dies | `countdownCancelAll` cancels **orders** only. | Our kill switch sends cancel plus closing orders. A second local watchdog is required if the main process can die while a position is open. Aster will not flatten the position for us. |
| News, sentiment, and strategy learning | Not Aster APIs. | Our agents and our database. |
| Silent proof that an imported API key cannot withdraw | No read-back of agent flags in the futures reference. | Generate the agent locally and submit the approval ourselves. |

## Live captures (2026-11-14)

These are market snapshots, not signals.

`GET /fapi/v3/time`

```json
{"serverTime": 1794663038208}
```

`GET /fapi/v3/premiumIndex?symbol=BTCUSDT`

```json
{
  "symbol": "BTCUSDT",
  "markPrice": "66644.40000000",
  "indexPrice": "66674.29195652",
  "estimatedSettlePrice": "66962.10566588",
  "lastFundingRate": "0.00003976",
  "interestRate": "0.00010000",
  "nextFundingTime": 1794672000000,
  "time": 1794663076001
}
```

`GET /fapi/v3/fundingRate?symbol=BTCUSDT&limit=2`

```json
[
  {"symbol": "BTCUSDT", "fundingTime": 1794614400000, "fundingRate": "0.00006920"},
  {"symbol": "BTCUSDT", "fundingTime": 1794643200000, "fundingRate": "0.00005186"}
]
```

`GET /fapi/v3/fundingInfo?symbol=BTCUSDT`

```json
[
  {
    "symbol": "BTCUSDT",
    "interestRate": "0.00010000",
    "time": 1794662999001,
    "fundingIntervalHours": 8,
    "fundingFeeCap": 0.003,
    "fundingFeeFloor": -0.003
  }
]
```

`GET /fapi/v3/klines?symbol=BTCUSDT&interval=5m&limit=2`

```json
[
  [1794662700000, "66591.9", "66723.0", "66514.0", "66644.4", "43.754", 1794662999999, "2914102.1301", 283, "24.470", "1629885.6676", "0"],
  [1794663000000, "66648.0", "66701.6", "66619.6", "66644.4", "8.974", 1794663299999, "598098.2924", 70, "2.048", "136511.2456", "0"]
]
```

`GET /fapi/v3/ticker/price?symbol=BTCUSDT`

```json
{"symbol": "BTCUSDT", "price": "66649.2", "time": 1794663076550}
```

`GET /fapi/v3/ticker/bookTicker?symbol=BTCUSDT`

```json
{
  "symbol": "BTCUSDT",
  "bidPrice": "66666.9",
  "bidQty": "0.154",
  "askPrice": "66667.0",
  "askQty": "1.989",
  "time": 1794663077750,
  "lastUpdateId": 653750447656
}
```

`GET /fapi/v3/depth?symbol=BTCUSDT&limit=5` (top of book only)

```json
{
  "lastUpdateId": 653750451325,
  "E": 1794663077970,
  "T": 1794663077950,
  "bids": [["66666.9", "2.710"], ["66665.7", "0.286"]],
  "asks": [["66667.0", "1.989"], ["66667.2", "0.001"]]
}
```

`wss://fstream.asterdex.com/ws/btcusdt@markPrice`

```json
{"e":"markPriceUpdate","E":1794663096000,"s":"BTCUSDT","p":"66701.40000000","P":"66959.25454088","i":"66715.43652174","r":"0.00003976","T":1794672000000}
```

Testnet `GET /fapi/v3/premiumIndex?symbol=BTCUSDT` also returned 200 (`markPrice` `66676.96932426`, `lastFundingRate` `0.00005326`).

## Open questions

These block the stage named in the last column. They do not block market-data work.

1. **Does `POST /fapi/v3/order` require `user` in the signed string?** The auth table and the deposit demo say yes. The order code sample never adds it. Prove on testnet. Blocks Stage 6.
2. **Nonce unit for futures orders.** Futures reference: microseconds, plus or minus 60 seconds. Deposit demo Pro API section: nanoseconds, 30 seconds. Follow the futures reference unless testnet rejects it. Blocks Stage 6.
3. **Approval payload.** Futures markdown: `registerAndApproveAgent`, primary type `Message`, domain chainId `signatureChainId` 56. asterCode site: `approveAgent`, primary type `ApproveAgent`, and that site's auth page also mentions domain chainId 1666/714 for a different flow. One testnet approval has to succeed before any mainnet signature. Blocks Stage 6.
4. **MetaMask and chainId 56.** The approval domain chainId is 56 even if the user is connected to Ethereum or Arbitrum. `eth_signTypedData_v4` usually signs a domain without switching networks. Confirm with the user's wallet on testnet. Blocks Stage 6.
5. **Can a `canWithdraw=false` agent still call TRANSFER routes** (futures/spot, sub-account)? Not stated. The client allowlist will omit them either way. Confirm on testnet with a deliberate rejected call before mainnet, using a zero-amount or otherwise harmless request if Aster provides one. If the only way to test is a real transfer, do not run that test. Blocks Stage 8, not Stage 6 reads.
6. **How is `POST /fapi/v3/listenKey` signed** when the parameter table is empty? Blocks the private user stream in Stage 7. REST polling can cover Stage 6.
7. **Does testnet enforce error `-5050` until a deposit?** Unknown. Also unknown: where testnet margin comes from. Blocks Stage 6 if the error appears.
8. **Meaning of testnet `rateLimits.limit = -2`.** Unknown. Do not treat it as a license to hammer the API.
9. **Gas on `registerAndApproveAgent`.** Official text does not say. Do not promise a gas-free approval.
10. **`fapi3` and `fapi5`.** Rejected or unreachable here. Confirm we are right to ignore them if Aster publishes a correction. Does not block while `fapi.asterdex.com` keeps answering.
11. **Parameter order.** The signed string must equal the sent string. The overview's ASCII sort is a different algorithm. Implement exact-string signing and freeze the order in one function. Prove on testnet.
12. **HTTP 200 strategy rejections.** Any use of `placeStrategyOrder` must branch on `failureCode`. Prefer separate stop and take-profit orders in the first execution stage so this footgun waits.
13. **Public `openInterest`.** It answered and it is undocumented. Leave it unused.
14. **SUI perp deposits.** Documented as spot-only, and the public asset list came back empty. Out of scope.
15. **Account privacy.** If the Aster account privacy flag is off, `aster_getBalance` may expose the address. Tell the user. Do not depend on the RPC.
