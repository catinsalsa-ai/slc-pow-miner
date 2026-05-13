import os from 'os';
import { Worker } from 'worker_threads';
import { ethers } from 'ethers';
import { config, requireBurnerKey } from './config.js';
import { provider, contract, mineParams, gasSnapshot, challenge as makeChallenge, commitment as makeCommitment, fmtGwei, fmtEth } from './slc.js';
import { cudaAvailable, cudaSearchOnce } from './cuda.js';
import { buildReportStats, reportingEnabled, sendReport } from './report.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function short(x) { return `${String(x).slice(0,10)}…${String(x).slice(-6)}`; }
function nowTime() { return new Date().toLocaleTimeString('en-GB', { hour12: false }); }
function fmtHashrate(hps) {
  if (!Number.isFinite(hps) || hps <= 0) return '0 H/s';
  if (hps >= 1e9) return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6) return `${(hps / 1e6).toFixed(1)} MH/s`;
  if (hps >= 1e3) return `${(hps / 1e3).toFixed(1)} KH/s`;
  return `${Math.round(hps)} H/s`;
}
function fmtCount(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
function printBanner(wallet, budgetLabel, workerLabel) {
  console.log('');
  console.log('SLC CUDA Miner');
  console.log('────────────────────────────────────────');
  console.log(`Wallet      : ${wallet}`);
  console.log(`Mode        : ${config.runTx ? 'LIVE MAINNET TX ENABLED' : 'DRY-RUN / no TX'}`);
  console.log(`Backend     : ${config.gpu ? 'CUDA primary' : 'CPU only'}`);
  console.log(`Budget      : ${budgetLabel}`);
  console.log(`Gas cap     : ${config.maxGasGwei} gwei | priority ${config.priorityFeeGwei} gwei`);
  console.log(`CUDA batch  : ${config.cudaBatch}`);
  console.log(`CUDA worker : ${config.cudaPersistent ? 'persistent v2' : 'one-shot v1'}`);
  console.log(`CUDA launch : threads=${config.cudaThreads || 'auto'} blocks=${config.cudaBlocks || 'SM*mult'} mult=${config.cudaBlocksMult || 'auto'}`);
  console.log(`State cache : ${config.stateCacheMs}ms`);
  console.log(`CPU fallback: ${workerLabel}`);
  console.log(`Log every   : ${config.logEverySec}s`);
  console.log(`Dashboard   : ${reportingEnabled(config) ? `ON as ${config.minerName}` : 'OFF (REPORT=off)'}`);
  console.log('────────────────────────────────────────');
  if (config.runTx) console.log('⚠️  Live mode aktif: TX beneran dikirim kalau nonce valid ketemu.');
  console.log('');
}

async function searchOnce({ ch, target, miner }) {
  if (config.gpu) {
    if (cudaAvailable()) {
      try {
        return await cudaSearchOnce({ ch, target, miner });
      } catch (err) {
        console.log(`\n[cuda] failed: ${err.message}`);
        console.log('[cuda] falling back to CPU workers for this round');
      }
    } else {
      console.log('\n[cuda] GPU=1 but bin/slc-cuda not found. Run: npm run build:cuda');
      console.log('[cuda] falling back to CPU workers for this round');
    }
  }

  const workers = config.workers || Math.max(1, os.cpus().length - 1);
  const randomBase = BigInt('0x' + Buffer.from(ethers.randomBytes(16)).toString('hex'));
  const batchPerWorker = config.batchSize;
  const promises = [];
  const started = Date.now();
  let settled = false;

  for (let i = 0; i < workers; i++) {
    promises.push(new Promise((resolve, reject) => {
      const w = new Worker(new URL('./worker.js', import.meta.url), {
        workerData: { challenge: ch, miner, target: target.toString(), start: (randomBase + BigInt(i)).toString(), stride: workers, batchSize: batchPerWorker }
      });
      w.on('message', msg => {
        if (msg.found && !settled) {
          settled = true;
          resolve({ ...msg, worker: i, totalTried: msg.tried });
        }
      });
      w.on('error', reject);
      w.on('exit', code => {
        if (!settled && code !== 0) reject(new Error(`worker ${i} exited ${code}`));
        else if (!settled) resolve(null);
      });
    }));
  }

  const results = await Promise.all(promises);
  const found = results.find(Boolean);
  const totalTried = workers * batchPerWorker;
  const dt = Math.max(0.001, (Date.now() - started) / 1000);
  return found || { found: false, tried: totalTried, hps: totalTried / dt };
}

async function main() {
  const pk = requireBurnerKey();
  const p = provider(config.rpcUrl);
  const wallet = new ethers.Wallet(pk, p);
  const c = contract(wallet);
  const [startEth, startSlc] = await Promise.all([
    p.getBalance(wallet.address),
    contract(p).balanceOf(wallet.address).catch(() => 0n),
  ]);
  const budgetLabel = config.budgetCapEnabled ? `${config.budgetEth} ETH` : 'unlimited (BUDGET_ETH=0)';
  const workerLabel = `${config.workers || Math.max(1, os.cpus().length - 1)} workers`;
  printBanner(wallet.address, budgetLabel, workerLabel);

  let statRounds = 0;
  let statHashes = 0;
  let statGpuHpsSum = 0;
  let statGpuHpsSamples = 0;
  let statStart = Date.now();
  let lastBlock = 0;
  let lastBackend = config.gpu ? 'cuda' : 'cpu';
  let lastReportAt = 0;
  let lastReportHps = 0;
  let wins = 0;
  let lastWin = null;
  let reportInFlight = false;
  let lastReportWorkers = config.gpu ? (config.cudaThreads || undefined) : (config.workers || undefined);

  async function maybeReport({ force = false, hps = lastReportHps, epoch = undefined } = {}) {
    if (!reportingEnabled(config) || reportInFlight) return;
    const now = Date.now();
    if (!force && now - lastReportAt < 60000) return;
    lastReportAt = now;
    reportInFlight = true;
    try {
      const stats = await buildReportStats({ p, c, wallet, config, startEth, startSlc, hps, epoch, wins, lastWin, workers: lastReportWorkers });
      const res = await sendReport(wallet, stats);
      if (res?.ok === false) {
        console.log(`[report] dashboard skipped (${res.status || 'error'}): ${String(res.error || '').slice(0, 120)}`);
      } else if (force) {
        console.log('[report] dashboard updated');
      }
    } catch (err) {
      console.log(`[report] dashboard skipped: ${err?.message || err}`);
    } finally {
      reportInFlight = false;
    }
  }

  while (true) {
    const nowLoop = Date.now();
    if (!main.cachedState || nowLoop - main.cachedState.at > config.stateCacheMs) {
      const [gas, params, block] = await Promise.all([
        gasSnapshot(p),
        mineParams(c),
        p.getBlock('latest'),
      ]);
      main.cachedState = { at: nowLoop, gas, params, block };
    }
    const { gas, params, block } = main.cachedState;
    if (gas.gasGwei > config.maxGasGwei) {
      console.log(`[gas] ${gas.gasGwei.toFixed(3)} gwei > cap ${config.maxGasGwei}; waiting 20s`);
      await sleep(20000);
      continue;
    }
    if (config.budgetCapEnabled) {
      const spent = startEth - await p.getBalance(wallet.address);
      if (Number(fmtEth(spent)) >= config.budgetEth) {
        console.log(`[stop] gas spent ${fmtEth(spent)} ETH reached budget ${config.budgetEth}`);
        break;
      }
    }

    if (!params.poolLive) {
      console.log('[wait] poolLive=false; waiting 60s');
      await sleep(60000);
      continue;
    }
    const ch = makeChallenge(block.hash, params.epochSeed);
    const result = await searchOnce({ ch, target: params.target, miner: wallet.address });
    const backend = result.backend ? `${result.backend}${result.device ? `/${result.device}` : ''}` : 'cpu';
    lastBackend = backend;
    if (Number(result.blocks) > 0 && Number(result.threads) > 0) {
      lastReportWorkers = Number(result.blocks) * Number(result.threads);
    } else if (!config.gpu) {
      lastReportWorkers = config.workers || Math.max(1, os.cpus().length - 1);
    }
    statRounds += 1;
    statHashes += Number(result.tried || config.cudaBatch || 0);
    if (Number.isFinite(result.hps) && result.hps > 0) {
      statGpuHpsSum += result.hps;
      statGpuHpsSamples += 1;
    }
    const elapsed = Math.max(0.001, (Date.now() - statStart) / 1000);
    const shouldLog = result.found || elapsed >= config.logEverySec || block.number !== lastBlock;
    if (shouldLog) {
      const loopHps = statHashes / elapsed;
      const gpuHps = statGpuHpsSamples > 0 ? statGpuHpsSum / statGpuHpsSamples : loopHps;
      lastReportHps = gpuHps;
      const status = result.found ? '🎯 FOUND' : '⛏️  mining';
      const launch = result.blocks && result.threads ? ` | launch=${result.blocks}x${result.threads}` : '';
      console.log(`[${nowTime()}] ${status} | block=${block.number} epoch=${params.epoch} | gpu=${fmtHashrate(gpuHps)} | loop=${fmtHashrate(loopHps)} | tried=${fmtCount(statHashes)} / ${statRounds} rounds | gas=${fmtGwei(gas.gasPrice)} gwei | ${lastBackend}${launch}`);
      statRounds = 0;
      statHashes = 0;
      statGpuHpsSum = 0;
      statGpuHpsSamples = 0;
      statStart = Date.now();
      lastBlock = block.number;
      void maybeReport({ hps: gpuHps, epoch: params.epoch });
    }
    if (!result.found) {
      continue;
    }
    console.log(`[found] nonce=${result.nonce} hash=${short(result.hash)}`);

    // Re-read params to avoid spending gas on stale epoch/target.
    const fresh = await mineParams(c);
    if (fresh.epoch !== params.epoch || fresh.target !== params.target) {
      console.log('[drop] epoch/target moved during search; restarting without tx');
      continue;
    }
    if (!config.runTx) {
      console.log('[dry-run] RUN_TX=false, not sending commit/reveal. Set RUN_TX=true only after you approve mainnet gas risk.');
      continue;
    }

    const secret = ethers.hexlify(ethers.randomBytes(32));
    const cm = makeCommitment(result.nonce, secret, wallet.address, block.number);
    const feeData = await p.getFeeData();
    const priority = ethers.parseUnits(String(config.priorityFeeGwei), 'gwei');
    const gasCap = ethers.parseUnits(String(config.maxGasGwei), 'gwei');
    const baseFee = block.baseFeePerGas ?? feeData.gasPrice ?? gas.gasPrice;
    let maxFeePerGas = (baseFee * 2n) + priority;
    if (maxFeePerGas > gasCap) maxFeePerGas = gasCap;
    if (priority > maxFeePerGas) maxFeePerGas = priority;
    const txOpts = { maxFeePerGas, maxPriorityFeePerGas: priority };
    console.log(`[fee] base=${fmtGwei(baseFee)} gwei priority=${config.priorityFeeGwei} gwei maxFee=${fmtGwei(maxFeePerGas)} gwei cap=${config.maxGasGwei} gwei`);

    let commitGas = 0n;
    let revealGas = 0n;
    try {
      [commitGas, revealGas] = await Promise.all([
        c.commit.estimateGas(cm, txOpts),
        c.reveal.estimateGas(result.nonce, secret, block.number, txOpts),
      ]);
      const balanceNow = await p.getBalance(wallet.address);
      const neededWei = ((commitGas + revealGas) * maxFeePerGas * 12n) / 10n;
      if (balanceNow < neededWei) {
        console.log(`[skip] insufficient ETH for commit+reveal gas; have=${fmtEth(balanceNow)} ETH need≈${fmtEth(neededWei)} ETH. Top up burner wallet.`);
        continue;
      }
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_FUNDS' || String(err?.message || '').includes('insufficient funds')) {
        const balanceNow = await p.getBalance(wallet.address).catch(() => 0n);
        console.log(`[skip] insufficient ETH for gas preflight; have=${fmtEth(balanceNow)} ETH. Top up burner wallet before live mining.`);
        continue;
      }
      console.log(`[skip] gas preflight failed: ${err?.shortMessage || err?.message || err}`);
      continue;
    }

    try {
      console.log(`[tx] commit ${short(cm)} gas≈${commitGas.toString()}`);
      const commitTx = await c.commit(cm, { ...txOpts, gasLimit: (commitGas * 13n) / 10n });
      console.log(`[tx] commit sent ${commitTx.hash}`);
      const receipt = await commitTx.wait(1);
      if (!receipt || receipt.status !== 1) {
        console.log('[tx] commit failed/reverted; restarting');
        continue;
      }
      console.log(`[tx] commit mined block=${receipt.blockNumber}; sending reveal for next block best-effort`);
      const revealTx = await c.reveal(result.nonce, secret, block.number, { ...txOpts, gasLimit: (revealGas * 13n) / 10n });
      console.log(`[tx] reveal sent ${revealTx.hash}`);
      const rr = await revealTx.wait(1);
      console.log(rr?.status === 1 ? `[win] reveal success block=${rr.blockNumber}` : `[miss] reveal reverted block=${rr?.blockNumber}`);
      if (rr?.status === 1) {
        wins += 1;
        lastWin = { tx: revealTx.hash, block: rr.blockNumber, at: Date.now() };
        void maybeReport({ force: true, hps: lastReportHps, epoch: fresh.epoch });
      }
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_FUNDS' || String(err?.message || '').includes('insufficient funds')) {
        const balanceNow = await p.getBalance(wallet.address).catch(() => 0n);
        console.log(`[tx] insufficient ETH during tx flow; have=${fmtEth(balanceNow)} ETH. Top up burner wallet.`);
      } else {
        console.log(`[tx] failed: ${err?.shortMessage || err?.message || err}`);
      }
      continue;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
