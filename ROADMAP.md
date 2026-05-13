# Roadmap

## Phase 1 — Safe MVP

- [x] Read-only status checker
- [x] SLC contract ABI and `mineParams()` reader
- [x] DEX Screener price lookup
- [x] JS CPU proof search
- [x] Commit/reveal transaction path behind `RUN_TX=true`
- [x] Gas cap and budget cap
- [x] Full VPS runbook

## Phase 2 — Better CPU mining

- [ ] Rust/N-API native keccak addon
- [ ] Multi-threaded native worker pool
- [ ] H/s progress reporting per round
- [ ] CPU verification tests for proof and commitment encoding

## Phase 3 — GPU mining

- [ ] OpenCL backend
- [ ] CUDA backend for NVIDIA VPS
- [ ] GPU self-test at startup
- [ ] Auto backend selection: CUDA > OpenCL > native CPU > JS

## Phase 4 — Production transaction strategy

- [ ] Builder bundle support for exact commit/reveal block targeting
- [ ] Better nonce management and receipt polling
- [ ] Reorg/missed reveal handling
- [ ] Optional dashboard telemetry, still off by default

## Phase 5 — Ops

- [ ] Dockerfile
- [ ] systemd service template
- [ ] Prometheus/JSON status output
- [ ] Multi-wallet mode for separate burner wallets
