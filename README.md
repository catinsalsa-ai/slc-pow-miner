# SLC PoW Miner MVP

CPU-safe Silicoin / SLC proof-of-work miner prototype built from the public [`humansilvian/silicoin-miner`](https://github.com/humansilvian/silicoin-miner) `SKILL.md` spec.

The upstream public repo currently ships `SKILL.md` but not the referenced `miner/` package, so this repo provides a runnable MVP implementation for VPS usage.

> **Important:** this touches Ethereum mainnet if you enable transactions. Use a burner wallet only. The default config is safe: read-only status works without a private key, and mining will not send transactions unless `RUN_TX=true`.

## Features

- Read-only status checker for the SLC contract
- Reads `mineParams()`, reward, total mined, gas, and DEX Screener price
- Optional wallet ETH/SLC balance check from local `.env`
- CPU JavaScript proof search using Node worker threads
- Optional CUDA backend for NVIDIA VPS/RTX via `bin/slc-cuda`
- Commit/reveal implementation based on the public skill spec
- Gas cap via `MAX_GAS_GWEI`
- Session spend cap via `BUDGET_ETH`
- Transaction kill switch: `RUN_TX=false` by default
- No telemetry/reporting by default: `REPORT=off`; set `REPORT=on` to appear on the Silicoin public miner dashboard

## Contract

```text
Chain: Ethereum mainnet
SLC contract: 0xbb572707D09eB2E80C835D3051097E5083D460Cc
```

Functions used:

```solidity
function mineParams() view returns (bytes32 epochSeed, uint256 target, uint256 reward, uint8 epoch, bool poolLive);
function commit(bytes32 commitment) external;
function reveal(uint256 nonce, bytes32 secret, uint256 anchorBlock) external;
function totalMined() view returns (uint256);
function currentReward() view returns (uint256);
function balanceOf(address) view returns (uint256);
```

## Quick start

```bash
git clone https://github.com/catinsalsa-ai/slc-pow-miner.git
cd slc-pow-miner
npm install
cp .env.example .env
nano .env
npm run status
npm run bench
# Optional NVIDIA/CUDA path:
# npm run build:cuda
# set GPU=true in .env
npm run mine
```

Keep `RUN_TX=false` until you intentionally want to send mainnet transactions.

Full VPS tutorial: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)

Full GPU/CUDA tutorial for NVIDIA VPS/RTX: [`docs/GPU-CUDA-RUNBOOK.md`](docs/GPU-CUDA-RUNBOOK.md)

Vast.ai RTX 5090 / CUDA 13.2 guide: [`docs/VAST-RTX5090-CUDA13-GUIDE.md`](docs/VAST-RTX5090-CUDA13-GUIDE.md)

## Scripts

```bash
npm run status   # read-only contract/gas/price/wallet status
npm run bench    # local JS CPU keccak benchmark
npm run mine     # proof search; uses RUN_TX from .env
npm run mine:dry # force dry-run, overrides .env RUN_TX
npm run mine:live # force LIVE mainnet tx mode, overrides .env RUN_TX
npm run check    # syntax checks
npm run build:cuda # optional: compile CUDA backend with nvcc
```

## Current limitations

This repo now includes a CUDA backend scaffold for NVIDIA VPS/RTX machines. The default remains CPU/dry-run for safety. Serious production mining still needs more work around builder bundles and exact commit/reveal targeting.

- CUDA GPU backend: included as `native/cuda_miner.cu`, build with `npm run build:cuda`
- Native Rust/N-API keccak backend: still planned as a CPU speed path
- OpenCL GPU backend: still planned as cross-vendor fallback
- Builder bundle support for exact commit/reveal block targeting

See [`ROADMAP.md`](ROADMAP.md).

## Safety rules

- Never use your main wallet.
- Never paste private keys into chat, GitHub, Discord, Telegram, screenshots, or issues.
- Put the burner private key only in local `.env` on your VPS.
- Start with tiny ETH funding and low `BUDGET_ETH`.
- Keep `REPORT=off` unless you explicitly want public dashboard telemetry. Use `REPORT=on` + `MINER_NAME=your-name` to appear at `silicoin.network` miners list; only signed stats are sent, never your private key.
- Keep `RUN_TX=false` for dry-run mode.

## License

MIT


### Cleaner logs

Set `LOG_EVERY_SEC=5` in `.env` to print one aggregated mining status line every 5 seconds instead of one line per CUDA batch. Increase to `10` for quieter tmux logs.


Note: The status line shows `gpu=` for CUDA kernel speed and `loop=` for end-to-end speed including RPC and contract reads. In v2 persistent mode, process startup overhead is mostly removed after the first round.

### RTX 5090 max modes

For short CUDA batches, GPU dashboards can show 0% because the kernel finishes in milliseconds. Use larger batch scripts to keep the GPU busy longer:

```bash
npm run mine:max       # live mode, GPU=true, CUDA_BATCH=268435456
npm run mine:turbo     # live mode, GPU=true, CUDA_BATCH=536870912
npm run mine:v2        # live mode, persistent CUDA worker, CUDA_BATCH=268435456
npm run mine:v2:turbo  # live mode, persistent CUDA worker, CUDA_BATCH=536870912
```

Start with `mine:v2`. If gas/block conditions are stable and the VPS is healthy, try `mine:v2:turbo`. The v2 mode keeps the CUDA helper alive between rounds, reducing process spawn/init overhead. Larger batches make GPU utilization more visible and reduce wrapper/RPC overhead, but they can waste more work if the block/epoch changes mid-batch.

Kernel optimization note: the CUDA helper precomputes static Keccak lanes per challenge and only injects nonce lanes inside the hot kernel loop. This reduces per-thread message-buffer setup versus the original MVP kernel.

To show up on the official dashboard, set `REPORT=on` in `.env`; the miner reports every ~60s and once after a successful reveal.

Monitor with:

```bash
nvidia-smi dmon -s pucvmet -d 1
```
