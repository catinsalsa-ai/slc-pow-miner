#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
if ! command -v nvcc >/dev/null 2>&1; then
  echo "nvcc not found. Install CUDA Toolkit first." >&2
  exit 127
fi
# Do not hardcode -arch. CUDA 13+ may reject old sm_70 flags; nvcc default is safer for mixed RTX VPS.
nvcc -O3 --use_fast_math -lineinfo native/cuda_miner.cu -o bin/slc-cuda -lcudart
bin/slc-cuda 0x0000000000000000000000000000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff 1 1 >/tmp/slc-cuda-selftest.json
node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('/tmp/slc-cuda-selftest.json','utf8')); if(!j.type) process.exit(1); console.log('CUDA self-test OK:', j.device, Math.round(Number(j.hps || 0)).toLocaleString(), 'H/s')"
