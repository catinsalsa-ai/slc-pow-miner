# GPU / CUDA Runbook — SLC PoW Miner

This guide is the full NVIDIA VPS / RTX setup path for the optional CUDA backend.

The CUDA backend only searches nonces. It never sees your private key and never sends transactions. Node.js still handles RPC, gas checks, budget checks, commit/reveal, and safety gates.

## 0. Safety first

Default mode is safe:

```env
RUN_TX=false
```

Keep it that way until the GPU miner builds, runs, and you understand the gas risk.

Rules:

- Use a burner wallet only.
- Never paste private keys into chat, GitHub, screenshots, or logs.
- Keep `.env` local on the VPS only.
- Start with tiny ETH funding.
- Keep `BUDGET_ETH` low.
- Keep `MAX_GAS_GWEI` low.

## 1. What the CUDA backend does

The GPU binary searches uint64 nonce ranges for:

```text
keccak256(bytes32 challenge ++ address miner ++ uint256 nonce) < target
```

Flow:

```text
Node.js reads mineParams + latest block
        ↓
Node.js computes challenge
        ↓
CUDA binary searches nonce range
        ↓
CUDA returns JSON result
        ↓
Node.js CPU-verifies nonce/hash with ethers
        ↓
If RUN_TX=true, Node.js handles commit/reveal
```

Files:

```text
native/cuda_miner.cu     CUDA kernel/searcher
native/build_cuda.sh     nvcc build script
src/cuda.js              Node.js wrapper
bin/slc-cuda             compiled local binary, git-ignored
```

## 2. VPS requirements

Recommended:

- Ubuntu 22.04 / 24.04
- NVIDIA GPU / RTX VPS
- NVIDIA driver working
- CUDA Toolkit with `nvcc`
- Node.js >= 20
- Git, tmux, build tools

Minimum commands to check:

```bash
nvidia-smi
nvcc --version
node -v
npm -v
```

Expected:

- `nvidia-smi` shows your RTX GPU.
- `nvcc --version` prints CUDA compiler version.
- `node -v` is v20+.

If `nvidia-smi` fails, the VPS GPU driver is not ready.
If `nvidia-smi` works but `nvcc` fails, the driver exists but CUDA Toolkit compiler is missing.

## 3. Install system dependencies

Ubuntu/Debian base packages:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates tmux build-essential
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 4. Install CUDA Toolkit if `nvcc` is missing

First check:

```bash
nvidia-smi
nvcc --version
```

If `nvcc` is not found, install CUDA Toolkit using NVIDIA's official repo for your OS. For Ubuntu 22.04, typical flow:

```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit
```

Then reload shell paths:

```bash
export PATH=/usr/local/cuda/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
nvcc --version
```

For Ubuntu 24.04, use NVIDIA's Ubuntu 24.04 CUDA repo instead of the 22.04 URL. If your GPU provider offers an image called CUDA / PyTorch / NVIDIA, use that image to avoid manual driver/toolkit setup.

## 5. Clone repo and install dependencies

```bash
git clone https://github.com/catinsalsa-ai/slc-pow-miner.git
cd slc-pow-miner
npm install
npm run check
```

## 6. Build CUDA backend

```bash
npm run build:cuda
```

This compiles:

```text
native/cuda_miner.cu → bin/slc-cuda
```

The build script also runs a tiny self-test.

Successful output should look like:

```text
CUDA self-test OK: NVIDIA ... H/s
```

If build fails with `nvcc not found`, go back to section 4.

If build fails with architecture errors, do not hardcode old `-arch=sm_70`. This repo intentionally does not set a fixed arch flag so newer RTX/CUDA versions can JIT properly.

## 7. Create `.env`

```bash
cp .env.example .env
nano .env
```

Safe GPU dry-run config:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=0xYOUR_BURNER_PRIVATE_KEY_HERE
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
RUN_TX=false
WORKERS=0
BATCH_SIZE=50000
ANCHOR_REFRESH_BLOCKS=20
REPORT=off
MINER_NAME=maulana-rtx

GPU=true
CUDA_BATCH=4194304
CUDA_MINER_BIN=
```

Notes:

- `GPU=true` enables CUDA path.
- `CUDA_BATCH=4194304` means the GPU checks about 4.19M nonces per dispatch.
- Increase `CUDA_BATCH` for fewer process launches and better throughput.
- Decrease `CUDA_BATCH` for faster responsiveness.
- `RUN_TX=false` means no transaction is sent.

## 8. Read-only status test

This checks RPC/contract/gas/price:

```bash
npm run status
```

If public RPC is flaky, use a private Ethereum RPC from Alchemy, Infura, QuickNode, Ankr, etc.

## 9. Dry-run GPU mining

Keep:

```env
RUN_TX=false
GPU=true
```

Run:

```bash
npm run mine
```

Expected log includes:

```text
RUN_TX=false — dry-run search only, NO TX will be sent
GPU=cuda CudaBatch=4194304
[search] ... no hit (... h/s approx, cuda/NVIDIA ...)
```

If CUDA fails, the miner will print an error and fall back to CPU workers.

Common causes:

- `bin/slc-cuda` missing → run `npm run build:cuda`
- `nvcc` missing → install CUDA Toolkit
- driver mismatch → use a GPU image from your VPS provider
- low target/difficulty → no hit is normal; GPU can run many rounds without finding a valid nonce

## 10. Tune CUDA batch

Start with:

```env
CUDA_BATCH=4194304
```

For RTX 3080 / 3090 / 4090 / 5090, try:

```env
CUDA_BATCH=8388608
```

or:

```env
CUDA_BATCH=16777216
```

Tradeoff:

- Larger batch: better throughput, slower reaction to new blocks/epoch changes.
- Smaller batch: more responsive, more process-launch overhead.

Practical suggestion:

```text
4M  = safe starter
8M  = good balanced
16M = more aggressive
32M = only if stable and block/epoch timing still okay
```

## 11. Run in tmux

```bash
tmux new -s slc-gpu
npm run mine
```

Detach:

```text
CTRL+B then D
```

Reattach:

```bash
tmux attach -t slc-gpu
```

Stop:

```text
CTRL+C
```

## 12. Live transaction mode

Only after dry-run works.

Checklist:

- [ ] Burner wallet only
- [ ] Private key is only in VPS `.env`
- [ ] Wallet has small ETH for gas
- [ ] `npm run status` works
- [ ] `npm run build:cuda` works
- [ ] `RUN_TX=false npm run mine` works
- [ ] You accept reverted/missed TX gas risk
- [ ] `BUDGET_ETH` is small
- [ ] `MAX_GAS_GWEI` is acceptable

Enable:

```env
RUN_TX=true
```

Run:

```bash
npm run mine
```

The miner will still stop/wait when:

- gas is above `MAX_GAS_GWEI`,
- session spend reaches `BUDGET_ETH`,
- pool is not live,
- epoch/target changed during search.

## 13. Updating from GitHub

```bash
cd slc-pow-miner
git pull
npm install
npm run check
npm run build:cuda
```

If `.env.example` changed, compare it with your local `.env` manually.

Never overwrite `.env` without backing it up.

## 14. Troubleshooting

### `GPU=1 but bin/slc-cuda not found`

Build CUDA:

```bash
npm run build:cuda
```

### `nvcc not found`

Install CUDA Toolkit, or switch to a CUDA-ready VPS image.

### `nvidia-smi: command not found`

NVIDIA driver is missing. Use a GPU image or install provider-recommended driver.

### Kernel launch failed

Check driver/toolkit compatibility:

```bash
nvidia-smi
nvcc --version
```

Use a provider image with matching driver + CUDA Toolkit if possible.

### CUDA hashrate is 0 or very low

Try larger batch:

```env
CUDA_BATCH=8388608
```

Also make sure you are not accidentally falling back to CPU. Logs should show `cuda/NVIDIA ...`.

### Dry-run finds nonce but no transaction

That is expected when:

```env
RUN_TX=false
```

Set `RUN_TX=true` only when ready for mainnet gas.

### Transaction reverts or misses

Possible reasons:

- Someone else mined faster.
- Epoch/target changed.
- Commit/reveal timing missed.
- Gas too low.
- Public mempool delay.

This is why serious production mode should eventually add builder/private bundle support.

## 15. Recommended serious-mining config starter

Conservative:

```env
GPU=true
CUDA_BATCH=4194304
RUN_TX=true
BUDGET_ETH=0.003
MAX_GAS_GWEI=3
PRIORITY_FEE_GWEI=0.2
REPORT=off
```

More aggressive, only if you accept gas risk:

```env
GPU=true
CUDA_BATCH=16777216
RUN_TX=true
BUDGET_ETH=0.01
MAX_GAS_GWEI=8
PRIORITY_FEE_GWEI=1
REPORT=off
```

## 16. Current limitations

This CUDA backend is the first serious speed upgrade, but not the final production miner.

Remaining production upgrades:

- persistent CUDA worker instead of spawning binary per round,
- live hashrate/status panel,
- exact block commit/reveal bundle strategy,
- better receipt tracking,
- optional multi-wallet burner mode,
- OpenCL fallback for AMD/non-NVIDIA GPUs.

For now, it is good for RTX VPS testing and faster nonce search while keeping the repo safety-first.
