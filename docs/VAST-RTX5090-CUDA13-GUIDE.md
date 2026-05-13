# Vast.ai RTX 5090 / CUDA 13.2 Guide — SLC PoW Miner

This guide is tailored for the VPS spec below:

```text
Provider: Vast.ai
GPU: 1x NVIDIA RTX 5090
Max CUDA: 13.2
Driver: 384535
VRAM: 31.8 GB
CPU: AMD EPYC 9814 96-Core
Allocated CPU: 48 / 384 CPU
RAM: 64.4 GB
Disk: 32 GB
Network: ~538 Mbps up / ~508 Mbps down
Image: vastai/base-image_cuda-13.2.0-auto/jupyter
```

This machine is good for the CUDA backend because it already runs a CUDA 13.2 image and has a strong RTX 5090.

## 0. Important safety rules

This miner touches Ethereum mainnet only if you explicitly enable TX mode.

Default safe mode:

```env
RUN_TX=false
```

Rules:

- Use a burner wallet only.
- Never paste private keys into chat, GitHub, Discord, Telegram, screenshots, logs, or issues.
- Put the burner private key only in local `.env` on the VPS.
- Start with tiny ETH funding.
- Keep `BUDGET_ETH` low.
- Keep `MAX_GAS_GWEI` low.
- Keep `REPORT=off`.

## 1. Open the Vast instance terminal

From Vast.ai dashboard:

1. Click **Open** on the RTX 5090 instance.
2. Open terminal / SSH / Jupyter terminal.
3. Work inside a normal shell.

Check basic system info:

```bash
whoami
pwd
df -h
free -h
nvidia-smi
```

Expected GPU line should show RTX 5090 and around 31 GB VRAM.

## 2. Check CUDA compiler

Your image says CUDA 13.2, but still verify `nvcc`:

```bash
nvcc --version
```

If it works, continue.

If it says `nvcc: command not found`, load CUDA path:

```bash
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
nvcc --version
```

If still missing, install CUDA toolkit or switch Vast image to a CUDA devel image. For this specific image, it should usually be present.

## 3. Install base packages

```bash
apt update
apt install -y git curl ca-certificates tmux build-essential nano
```

If `apt` asks interactive questions, accept defaults.

## 4. Install Node.js 22

Check current Node:

```bash
node -v || true
npm -v || true
```

If Node is missing or older than v20, install Node 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

Expected:

```text
node v22.x
npm 10.x or newer
```

## 5. Clone miner repo

```bash
cd /root
git clone https://github.com/catinsalsa-ai/slc-pow-miner.git
cd slc-pow-miner
npm install
npm run check
```

If repo already exists:

```bash
cd /root/slc-pow-miner
git pull
npm install
npm run check
```

## 6. Build CUDA backend for RTX 5090

Do not hardcode old architecture flags like `sm_70`. CUDA 13.2 + RTX 5090 can break on old arch flags.

Use the repo build script:

```bash
npm run build:cuda
```

Expected output:

```text
CUDA self-test OK: NVIDIA GeForce RTX 5090 ... H/s
```

This creates:

```text
bin/slc-cuda
```

Verify binary exists:

```bash
ls -lh bin/slc-cuda
```

Run a direct tiny self-test manually:

```bash
./bin/slc-cuda \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000 \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  1 \
  1
```

It should print JSON.

## 7. Create `.env`

```bash
cp .env.example .env
nano .env
```

Use this RTX 5090 starter config:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=[REDACTED]
# BUDGET_ETH=0 disables session spend cap. Keep a small cap for first live runs.
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
RUN_TX=false
# WORKERS only affects CPU fallback. Vast may expose 384 host CPUs; set 48 to match allocated CPU.
WORKERS=48
BATCH_SIZE=50000
ANCHOR_REFRESH_BLOCKS=20
REPORT=off
MINER_NAME=vast-rtx5090

GPU=true
CUDA_BATCH=8388608
CUDA_MINER_BIN=
```

Why `CUDA_BATCH=8388608`?

- RTX 5090 is strong enough for bigger batches.
- 8M is a balanced starter.
- If logs are too fast / overhead too high, try 16M.
- If responsiveness is bad, go back to 4M.

Batch tuning options:

```env
CUDA_BATCH=4194304    # safe starter, responsive
CUDA_BATCH=8388608    # recommended RTX 5090 starter
CUDA_BATCH=16777216   # aggressive
CUDA_BATCH=33554432   # very aggressive; only if stable
```

## 8. Status check, read-only

This does not send transactions:

```bash
npm run status
```

Expected output includes:

```text
SLC miner status (read-only)
Chain ID: 1
Pool live: true/false
Epoch: ...
Reward: ... SLC
Gas price: ... gwei
Wallet: configured / not configured
```

If public RPC fails, use a private RPC. For mining, public RPC can be rate-limited.

Recommended `.env` with private RPC:

```env
RPC_URL=[REDACTED]
```

Do not commit `.env`.

## 9. Dry-run GPU mining

Keep this first:

```env
RUN_TX=false
GPU=true
```

Start miner:

```bash
npm run mine
```

Expected log pattern:

```text
SLC miner MVP starting for 0x...
RUN_TX=false — dry-run search only, NO TX will be sent
Budget=0.003 ETH MaxGas=3 gwei Batch=50000 Workers=47 GPU=cuda CudaBatch=8388608
[search] block=... epoch=... reward=... gas=...gwei ... no hit (... h/s approx, cuda/NVIDIA GeForce RTX 5090)
```

If it says `GPU=1 but bin/slc-cuda not found`, run:

```bash
npm run build:cuda
```

If CUDA fails and falls back to CPU, check:

```bash
nvidia-smi
nvcc --version
ls -lh bin/slc-cuda
```

## 10. Run in tmux

Use tmux so the miner keeps running after disconnect.

```bash
cd /root/slc-pow-miner
tmux new -s slc5090
npm run mine
```

Detach:

```text
CTRL+B then D
```

Reattach:

```bash
tmux attach -t slc5090
```

Stop miner:

```text
CTRL+C
```

Kill session if needed:

```bash
tmux kill-session -t slc5090
```

## 11. Monitor GPU usage

In another terminal:

```bash
watch -n 1 nvidia-smi
```

Or:

```bash
nvidia-smi dmon -s pucvmt
```

Notes:

- Current backend spawns a CUDA binary per search round, so GPU usage may appear bursty.
- If batch is too small, overhead is higher and GPU utilization can look low.
- Increase `CUDA_BATCH` gradually.

## 12. Live mining mode

Only enable after dry-run works.

Checklist:

- [ ] `npm run build:cuda` succeeded
- [ ] `npm run status` works
- [ ] dry-run `npm run mine` or `npm run mine:dry` shows `cuda/NVIDIA GeForce RTX 5090`
- [ ] burner wallet only
- [ ] wallet has small ETH amount
- [ ] `BUDGET_ETH` is small
- [ ] `MAX_GAS_GWEI` is acceptable
- [ ] you accept failed/reverted gas risk

Enable live TX:

```env
RUN_TX=true
```

Start live mode directly:

```bash
npm run mine:live
```

`npm run mine:live` forces `RUN_TX=true` for that command, so it avoids mistakes where `.env` still has `RUN_TX=false` or trailing spaces. If you prefer using `.env`, set `RUN_TX=true` then run `npm run mine`.

The miner still refuses/waits when:

- gas is above `MAX_GAS_GWEI`,
- `BUDGET_ETH` is reached,
- pool is not live,
- epoch/target changed during search.

## 13. Conservative config for first real run

Use this for first mainnet attempt:

```env
GPU=true
CUDA_BATCH=8388608
RUN_TX=true
# BUDGET_ETH=0 disables session spend cap. Keep a small cap for first live runs.
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
REPORT=off
```

This is intentionally strict.


### Disable budget cap

If you intentionally want no session spend cap, set:

```env
BUDGET_ETH=0
```

This does **not** give free gas and does **not** remove `MAX_GAS_GWEI`. It only disables the miner's session stop-loss. Use carefully; reverted/missed transactions can still burn ETH.

## 14. More aggressive config

Only if you accept more gas risk:

```env
GPU=true
CUDA_BATCH=16777216
RUN_TX=true
BUDGET_ETH=0.01
MAX_GAS_GWEI=8
PRIORITY_FEE_GWEI=1
REPORT=off
```

Do not start aggressive on a fresh wallet/session.

## 15. Disk/RAM notes for this VPS

Your disk is around 32 GB. Keep it clean.

Check disk:

```bash
df -h
```

Clean if needed:

```bash
npm cache clean --force
apt clean
rm -rf /tmp/*
```

Do not delete project files or `.env`.

RAM is 64 GB, enough for this miner.

## 16. Common fixes

### `npm install` fails

Try:

```bash
npm config set registry https://registry.npmjs.org/
npm install
```

### `nvcc fatal: Unsupported gpu architecture`

Make sure you are using repo script:

```bash
npm run build:cuda
```

Do not add old flags like:

```text
-arch=sm_70
```

### Log still says `RUN_TX=false`

If you expected live mode but the log says:

```text
RUN_TX=false — dry-run search only, NO TX will be sent
```

then `.env` is still false or not saved. Use the force-live command:

```bash
npm run mine:live
```

Expected live log:

```text
RUN_TX=true — LIVE MAINNET TX ENABLED
```

### `PRIVATE_KEY missing`

`npm run mine` requires a local burner key in `.env`.

`npm run status` does not.

### `RUN_TX=false` but GPU running

This is expected. GPU can search, but Node refuses to send TX.

### Low GPU utilization

Try larger batch:

```env
CUDA_BATCH=16777216
```

Then restart miner.

### Public RPC errors

Use private RPC. Public RPCs are okay for status, not ideal for mining.

## 17. Quick command checklist

Fresh Vast RTX 5090 setup:

```bash
apt update
apt install -y git curl ca-certificates tmux build-essential nano
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
cd /root
git clone https://github.com/catinsalsa-ai/slc-pow-miner.git
cd slc-pow-miner
npm install
npm run check
nvidia-smi
nvcc --version
npm run build:cuda
cp .env.example .env
nano .env
npm run status
npm run mine
```

Recommended dry-run `.env`:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=[REDACTED]
# BUDGET_ETH=0 disables session spend cap. Keep a small cap for first live runs.
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
RUN_TX=false
# WORKERS only affects CPU fallback. Vast may expose 384 host CPUs; set 48 to match allocated CPU.
WORKERS=48
BATCH_SIZE=50000
ANCHOR_REFRESH_BLOCKS=20
REPORT=off
MINER_NAME=vast-rtx5090
GPU=true
CUDA_BATCH=8388608
CUDA_MINER_BIN=
```

After dry-run is stable, change only this for live mode:

```env
RUN_TX=true
```

## 18. Current production limitation

The current CUDA backend is a strong search speed upgrade, but commit/reveal production performance still depends on Ethereum inclusion timing.

Next serious upgrades:

- persistent CUDA worker process,
- better live hashrate panel,
- private/builder RPC for commit/reveal timing,
- receipt/revert tracking,
- exact block reveal bundle logic.

## 19. Note about `Workers=383` in logs

Your Vast container can expose the host CPU count, so `WORKERS=0` may show around `383 CPU fallback`. That does not mean CUDA is using 383 CPU threads. With `GPU=true`, workers are only used if CUDA fails and the miner falls back to CPU.

For your allocated 48 CPU cores, set this to avoid huge CPU fallback bursts:

```env
WORKERS=48
```

For pure CUDA runs, the important setting is still `CUDA_BATCH`, not `WORKERS`.


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
