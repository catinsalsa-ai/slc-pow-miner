# Full VPS Runbook — SLC PoW Miner MVP

This guide explains how to run the SLC PoW Miner MVP on a Linux VPS safely.

## 0. What this miner does

The miner follows the public SLC/Silicoin skill spec:

1. Reads `mineParams()` from the Ethereum mainnet SLC contract.
2. Picks the latest block hash as an anchor.
3. Computes `challenge = keccak256(anchorHash ++ epochSeed)`.
4. Searches for a nonce where:

```text
uint256(keccak256(challenge ++ minerAddress ++ nonce)) < target
```

5. If a valid nonce is found, prepares a `commit()` and `reveal()` transaction.
6. Only sends transactions if `RUN_TX=true`.

By default, this repo is safe for read-only testing and dry-run search.

## 1. VPS requirements

Recommended OS:

```text
Ubuntu 22.04 / 24.04 or Debian 12
```

Required tools:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates tmux build-essential
```

Install Node.js 20+.

Option A — NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Option B — if Node is already installed:

```bash
node -v
npm -v
```

You need Node `>=20`.

## 2. Clone and install

```bash
git clone https://github.com/catinsalsa-ai/slc-pow-miner.git
cd slc-pow-miner
npm install
```

Run syntax check:

```bash
npm run check
```

## 3. Create local config

```bash
cp .env.example .env
nano .env
```

Safe starter config:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
RUN_TX=false
WORKERS=0
BATCH_SIZE=50000
ANCHOR_REFRESH_BLOCKS=20
REPORT=off
MINER_NAME=maulana-vps
```

### Private key rule

Do **not** paste your private key into chat or GitHub.

Use a dedicated burner wallet:

- no NFTs,
- no valuable tokens,
- no wallet history you care about,
- only enough ETH for test gas.

Put the key only inside `.env` on the VPS:

```env
PRIVATE_KEY=0xYOUR_BURNER_PRIVATE_KEY_HERE
```

## 4. Read-only status test

This does not need a private key:

```bash
npm run status
```

Expected output includes:

```text
SLC miner status (read-only)
Chain ID: 1
Pool live: true
Epoch: ...
Reward: ... SLC
Gas price: ... gwei
DEX Screener: ...
Wallet: not configured
```

If RPC fails, edit `.env` and try another Ethereum mainnet RPC:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
```

Other public RPC options:

```text
https://rpc.ankr.com/eth
https://cloudflare-eth.com
```

For mining, a paid/private Alchemy, Infura, QuickNode, or own node RPC is better.

## 5. Benchmark

```bash
npm run bench
```

This MVP is pure JS CPU hashing, so it will be slow compared to native/GPU mining.

## 6. Dry-run mining, no transaction

Make sure `.env` has:

```env
RUN_TX=false
```

Then run:

```bash
npm run mine
```

Dry-run mode searches for valid nonces but refuses to send `commit()` / `reveal()` transactions.

You should see lines like:

```text
RUN_TX=false — dry-run search only, NO TX will be sent
[search] block=... epoch=... reward=... gas=...gwei ... no hit
```

## 7. Live mining mode

Only do this after you understand the risk.

Checklist:

- [ ] Burner wallet only
- [ ] Wallet has small ETH amount for gas
- [ ] `npm run status` works
- [ ] Gas is below your cap
- [ ] `BUDGET_ETH` is small
- [ ] You accept that failed/reverted transactions can still cost gas

Enable live transactions:

```env
RUN_TX=true
```

Start miner:

```bash
npm run mine
```

The miner will still stop or wait when:

- gas is higher than `MAX_GAS_GWEI`, or
- session spend reaches `BUDGET_ETH`, or
- pool is not live.

## 8. Run in tmux

Start session:

```bash
tmux new -s slc
npm run mine
```

Detach:

```text
CTRL+B then D
```

Reattach:

```bash
tmux attach -t slc
```

Stop miner:

```text
CTRL+C
```

## 9. Important config fields

### `RUN_TX`

```env
RUN_TX=false
```

Safe dry-run mode. No transaction is sent.

```env
RUN_TX=true
```

Live mainnet mode. Can spend gas.

### `BUDGET_ETH`

Session gas spend cap.

```env
BUDGET_ETH=0.003
```

Start tiny. Increase only after successful tests.

### `MAX_GAS_GWEI`

The miner waits if gas is above this cap.

```env
MAX_GAS_GWEI=3
```

### `WORKERS`

```env
WORKERS=0
```

Auto: CPU cores minus one.

Or set manually:

```env
WORKERS=8
```

### `BATCH_SIZE`

Nonces checked per worker per search round.

```env
BATCH_SIZE=50000
```

Increase for fewer logs and longer rounds; decrease for faster responsiveness.

## 10. Serious mining upgrade path

This MVP proves the logic and safe transaction controls. For serious mining, add one of:

### Native Rust/N-API keccak

Best CPU path:

- Rust addon computes keccak much faster than JS.
- Node keeps orchestration, gas, RPC, and transactions.
- Good first upgrade before GPU.

### OpenCL backend

Cross-platform GPU path:

- NVIDIA, AMD, and some Intel GPUs.
- Easier than CUDA for broad support.
- Slower than CUDA on NVIDIA.

### CUDA backend

Best NVIDIA path:

- Highest hashrate.
- Needs CUDA toolkit and NVIDIA driver.
- Best for RTX VPS/GPU machines.

### Builder bundles

The public spec says reveal must land exactly one block after commit. This MVP uses public mempool best-effort after commit confirmation. For production, exact-block builder bundles are better.

## 11. Troubleshooting

### `cd silicoin-miner/miner` failed

The upstream public repo currently does not include `miner/`. That is why this repo exists.

### RPC 503 / rate limit

Use another RPC in `.env`.

### `PRIVATE_KEY missing`

`npm run mine` requires a burner key. `npm run status` does not.

### `RUN_TX=false`

This is intentional safety. The miner found/searches proofs but will not send transactions until you set:

```env
RUN_TX=true
```

### Low hashrate

Expected for this MVP. Use native/GPU backend for serious mining.

## 12. Security reminder

Never commit `.env`. It is ignored by `.gitignore`.

Before pushing any changes, scan for real secrets with a trusted scanner or a local grep pattern. If anything suspicious prints, do not push.
