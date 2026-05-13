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
# BUDGET_ETH=0 disables session spend cap. Keep a small cap for first live runs.
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
RUN_TX=false
WORKERS=0
BATCH_SIZE=50000
ANCHOR_REFRESH_BLOCKS=20
REPORT=off
MINER_NAME=maulana-vps

# Optional NVIDIA CUDA backend
GPU=false
CUDA_BATCH=4194304
CUDA_MINER_BIN=
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
PRIVATE_KEY=[REDACTED]
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

For the complete NVIDIA VPS / RTX setup, see [`GPU-CUDA-RUNBOOK.md`](GPU-CUDA-RUNBOOK.md).

CPU benchmark:

```bash
npm run bench
```

Optional CUDA build for NVIDIA VPS/RTX:

```bash
nvidia-smi
nvcc --version
npm run build:cuda
```

If `nvcc` is missing, install CUDA Toolkit for your VPS image first. On many GPU VPS images, the NVIDIA driver exists but the compiler is not installed.

Enable CUDA in `.env` only after the build passes:

```env
GPU=true
CUDA_BATCH=4194304
```

Notes:

- `bin/slc-cuda` is ignored by git because it is a compiled binary.
- The Node wrapper CPU-verifies any CUDA-found nonce before transaction logic.
- If CUDA fails at runtime, the miner logs the error and falls back to CPU workers.
- `RUN_TX=false` still means no transaction, even with CUDA enabled.

## 6. Dry-run mining, no transaction

Make sure `.env` has:

```env
RUN_TX=false
```

Then run:

```bash
npm run mine
# or force live mode regardless of .env RUN_TX:
npm run mine:live
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

Best NVIDIA path and now included in this repo:

```bash
npm run build:cuda
```

Then edit `.env`:

```env
GPU=true
CUDA_BATCH=4194304
```

Run dry first:

```bash
RUN_TX=false npm run mine
```

The CUDA helper searches uint64 nonce ranges for:

```text
keccak256(bytes32 challenge ++ address miner ++ uint256 nonce) < target
```

The Node process still handles all RPC/gas/commit/reveal logic and verifies the CUDA result with ethers before any TX path.

### Builder bundles

The public spec says reveal must land exactly one block after commit. This MVP uses public mempool best-effort after commit confirmation. For production, exact-block builder bundles are better.


### Disable budget cap

If you intentionally want no session spend cap, set:

```env
BUDGET_ETH=0
```

This does **not** give free gas and does **not** remove `MAX_GAS_GWEI`. It only disables the miner's session stop-loss. Use carefully; reverted/missed transactions can still burn ETH.

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

If CPU hashrate is low, use the CUDA backend on NVIDIA VPS:

```bash
npm run build:cuda
# then set GPU=true in .env
npm run mine
```

If CUDA says `nvcc not found`, install CUDA Toolkit or use a GPU image that already includes it. If it says `bin/slc-cuda not found`, run `npm run build:cuda`.

## 12. Security reminder

Never commit `.env`. It is ignored by `.gitignore`.

Before pushing any changes, scan for real secrets with a trusted scanner or a local grep pattern. If anything suspicious prints, do not push.


## Cleaner logs

The miner aggregates fast CUDA batches and prints one status line every few seconds. Configure it in `.env`:

```env
LOG_EVERY_SEC=5
```

Use `LOG_EVERY_SEC=10` for quieter tmux logs, or `LOG_EVERY_SEC=1` if you want faster visual feedback. Mining speed is unchanged; only terminal output is throttled.


Note: The status line shows `gpu=` for CUDA kernel speed and `loop=` for end-to-end speed including RPC, process startup, and contract reads.


## Maximize GPU usage

If `nvidia-smi` shows 0% GPU while logs say `cuda/NVIDIA ...`, the CUDA kernel is probably finishing too fast between dashboard samples. Use a larger batch convenience script:

```bash
npm run mine:v2
```

This forces `RUN_TX=true GPU=true CUDA_PERSISTENT=true CUDA_BATCH=268435456 LOG_EVERY_SEC=5`. V2 keeps the CUDA helper alive between rounds, reducing process spawn/init overhead. If stable, try:

```bash
npm run mine:v2:turbo
```

`mine:v2:turbo` uses `CUDA_BATCH=536870912` with the persistent worker and can make utilization more visible, but it may waste more work if the block/epoch changes mid-batch. For monitoring:

```bash
nvidia-smi dmon -s pucvmet -d 1
```


### CUDA kernel optimization note

The v2 CUDA helper also optimizes the hot Keccak path: static lanes from `challenge + miner + padding` are built once per job, then the kernel only updates the nonce lanes for each thread. This reduces local message-buffer work per nonce. Node still CPU-verifies any found nonce before sending TX.


## Next-level CUDA miner mode

Use this after `npm run build:cuda` when you want the most aggressive preset currently available:

```bash
npm run mine:next
```

It forces persistent CUDA worker, 536M batch, launch tuning (`CUDA_THREADS=256`, `CUDA_BLOCKS_MULT=256`), and a short `STATE_CACHE_MS=2500` cache to reduce RPC overhead in the loop. To tune for the exact VPS/GPU, run:

```bash
npm run bench:cuda
```

Copy the best values into `.env`:

```env
CUDA_THREADS=256
CUDA_BLOCKS_MULT=256
STATE_CACHE_MS=2500
```

`mine:next` is live mainnet mode. Use burner wallet only and keep gas caps sane.
