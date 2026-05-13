import os from 'os';
import { Worker } from 'worker_threads';
import { ethers } from 'ethers';
import { config, requireBurnerKey } from './config.js';
import { provider, contract, mineParams, gasSnapshot, challenge as makeChallenge, commitment as makeCommitment, fmtGwei, fmtEth } from './slc.js';
import { cudaAvailable, cudaSearchOnce } from './cuda.js';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function short(x) { return `${String(x).slice(0,10)}…${String(x).slice(-6)}`; }

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
  const startEth = await p.getBalance(wallet.address);
  console.log(`SLC miner MVP starting for ${wallet.address}`);
  console.log(`RUN_TX=${config.runTx} — ${config.runTx ? 'LIVE MAINNET TX ENABLED' : 'dry-run search only, NO TX will be sent'}`);
  const budgetLabel = config.budgetCapEnabled ? `${config.budgetEth} ETH` : 'unlimited (BUDGET_ETH=0)';
  const workerLabel = `${config.workers || Math.max(1, os.cpus().length - 1)} CPU fallback`;
  console.log(`Budget=${budgetLabel} MaxGas=${config.maxGasGwei} gwei Batch=${config.batchSize} Workers=${workerLabel} GPU=${config.gpu ? 'cuda' : 'off'} CudaBatch=${config.cudaBatch}`);

  while (true) {
    const gas = await gasSnapshot(p);
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

    const params = await mineParams(c);
    if (!params.poolLive) {
      console.log('[wait] poolLive=false; waiting 60s');
      await sleep(60000);
      continue;
    }
    const block = await p.getBlock('latest');
    const ch = makeChallenge(block.hash, params.epochSeed);
    process.stdout.write(`[search] block=${block.number} epoch=${params.epoch} reward=${ethers.formatUnits(params.reward,18)} gas=${fmtGwei(gas.gasPrice)}gwei ... `);
    const result = await searchOnce({ ch, target: params.target, miner: wallet.address });
    if (!result.found) {
      const backend = result.backend ? `${result.backend}${result.device ? `/${result.device}` : ''}` : 'cpu';
      console.log(`no hit (${Math.round(result.hps || 0)} h/s approx, ${backend})`);
      continue;
    }
    console.log(`FOUND nonce=${result.nonce} hash=${short(result.hash)}`);

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
    const maxFeePerGas = (feeData.maxFeePerGas ?? gas.gasPrice * 2n) + priority;
    const txOpts = { maxFeePerGas, maxPriorityFeePerGas: priority };

    console.log(`[tx] commit ${short(cm)}`);
    const commitTx = await c.commit(cm, txOpts);
    console.log(`[tx] commit sent ${commitTx.hash}`);
    const receipt = await commitTx.wait(1);
    if (!receipt || receipt.status !== 1) {
      console.log('[tx] commit failed/reverted; restarting');
      continue;
    }
    console.log(`[tx] commit mined block=${receipt.blockNumber}; sending reveal for next block best-effort`);
    const revealTx = await c.reveal(result.nonce, secret, block.number, txOpts);
    console.log(`[tx] reveal sent ${revealTx.hash}`);
    const rr = await revealTx.wait(1);
    console.log(rr?.status === 1 ? `[win] reveal success block=${rr.blockNumber}` : `[miss] reveal reverted block=${rr?.blockNumber}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
