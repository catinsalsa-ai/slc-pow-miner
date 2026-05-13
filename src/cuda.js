import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { ethers } from 'ethers';
import { config } from './config.js';
import { proofHash, hashBeatsTarget } from './slc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function strip0x(x) { return String(x).startsWith('0x') ? String(x).slice(2) : String(x); }
function asUint64Decimal(x) { return (BigInt(x) & ((1n << 64n) - 1n)).toString(); }

export function findCudaBinary() {
  const candidates = [
    process.env.CUDA_MINER_BIN,
    path.join(rootDir, 'bin', 'slc-cuda'),
    path.join(process.cwd(), 'bin', 'slc-cuda'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function cudaAvailable() {
  return Boolean(findCudaBinary());
}

function cudaEnv() {
  const env = { ...process.env };
  if (config.cudaThreads > 0) env.CUDA_THREADS = String(config.cudaThreads);
  if (config.cudaBlocks > 0) env.CUDA_BLOCKS = String(config.cudaBlocks);
  if (config.cudaBlocksMult > 0) env.CUDA_BLOCKS_MULT = String(config.cudaBlocksMult);
  return env;
}

function parseCudaMessage(line) {
  try { return JSON.parse(line); }
  catch { throw new Error(`CUDA JSON parse failed: ${line}`); }
}

function verifyCudaResult({ msg, ch, target, miner, started }) {
  const tried = Number(msg.tried || config.cudaBatch);
  const dt = Math.max(0.001, (Date.now() - started) / 1000);
  const base = { backend: 'cuda', tried, hps: Number(msg.hps || tried / dt), device: msg.device || 'CUDA GPU', blocks: msg.blocks, threads: msg.threads };
  if (msg.type === 'error') throw new Error(`CUDA worker error: ${msg.error || 'unknown'}`);
  if (msg.type !== 'found') return { found: false, ...base };

  const cpuHash = proofHash(ch, miner, BigInt(msg.nonce));
  if (cpuHash.toLowerCase() !== String(msg.hash).toLowerCase()) {
    throw new Error(`CUDA self-check mismatch nonce=${msg.nonce} gpu=${msg.hash} cpu=${cpuHash}`);
  }
  if (!hashBeatsTarget(cpuHash, target)) {
    throw new Error(`CUDA nonce failed target check nonce=${msg.nonce} hash=${cpuHash}`);
  }
  return { found: true, nonce: msg.nonce, hash: cpuHash, ...base };
}

async function cudaSearchOneShot({ ch, target, miner, startNonce }) {
  const bin = findCudaBinary();
  if (!bin) throw new Error('CUDA binary not found. Run: npm run build:cuda');

  const start = asUint64Decimal(startNonce ?? BigInt('0x' + Buffer.from(ethers.randomBytes(8)).toString('hex')));
  const batch = String(config.cudaBatch);
  const args = [strip0x(ch), strip0x(miner), strip0x(ethers.toBeHex(target, 32)), start, batch];
  const started = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`CUDA miner exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!line) {
        reject(new Error('CUDA miner produced no JSON output'));
        return;
      }
      try {
        const msg = parseCudaMessage(line);
        resolve(verifyCudaResult({ msg, ch, target, miner, started }));
      } catch (err) { reject(err); }
    });
  });
}

class PersistentCudaWorker {
  constructor(bin) {
    this.bin = bin;
    this.child = null;
    this.rl = null;
    this.pending = null;
    this.stderrTail = '';
    this.ready = false;
  }

  start() {
    if (this.child && !this.child.killed) return;
    this.child = spawn(this.bin, ['--server'], { stdio: ['pipe', 'pipe', 'pipe'], env: cudaEnv() });
    this.ready = true;
    this.stderrTail = '';
    this.rl = readline.createInterface({ input: this.child.stdout });

    this.rl.on('line', line => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      try {
        const msg = parseCudaMessage(line);
        p.resolve(verifyCudaResult({ msg, ch: p.ch, target: p.target, miner: p.miner, started: p.started }));
      } catch (err) { p.reject(err); }
    });
    this.child.stderr.on('data', d => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-4000);
    });
    this.child.on('error', err => {
      this.ready = false;
      if (this.pending) {
        this.pending.reject(err);
        this.pending = null;
      }
    });
    this.child.on('close', code => {
      this.ready = false;
      const p = this.pending;
      this.pending = null;
      this.child = null;
      if (p) p.reject(new Error(`CUDA persistent worker exited ${code}: ${this.stderrTail.trim()}`));
    });
  }

  async search({ ch, target, miner, startNonce }) {
    this.start();
    if (!this.child?.stdin?.writable) throw new Error('CUDA persistent worker stdin not writable');
    if (this.pending) throw new Error('CUDA persistent worker already has a pending job');

    const start = asUint64Decimal(startNonce ?? BigInt('0x' + Buffer.from(ethers.randomBytes(8)).toString('hex')));
    const batch = String(config.cudaBatch);
    const line = `${strip0x(ch)} ${strip0x(miner)} ${strip0x(ethers.toBeHex(target, 32))} ${start} ${batch}\n`;
    const started = Date.now();
    return await new Promise((resolve, reject) => {
      this.pending = { resolve, reject, ch, target, miner, started };
      this.child.stdin.write(line, err => {
        if (!err) return;
        const p = this.pending;
        this.pending = null;
        p?.reject(err);
      });
    });
  }

  stop() {
    if (!this.child) return;
    try { this.child.stdin.write('quit\n'); } catch {}
    try { this.child.kill(); } catch {}
    this.child = null;
    this.pending = null;
    this.ready = false;
  }
}

let persistentWorker = null;

function getPersistentWorker() {
  const bin = findCudaBinary();
  if (!bin) throw new Error('CUDA binary not found. Run: npm run build:cuda');
  if (!persistentWorker || persistentWorker.bin !== bin) persistentWorker = new PersistentCudaWorker(bin);
  return persistentWorker;
}

export async function cudaSearchOnce({ ch, target, miner, startNonce }) {
  if (config.cudaPersistent) {
    try {
      return await getPersistentWorker().search({ ch, target, miner, startNonce });
    } catch (err) {
      if (persistentWorker) persistentWorker.stop();
      throw new Error(`CUDA persistent worker failed: ${err.message}`);
    }
  }
  return await cudaSearchOneShot({ ch, target, miner, startNonce });
}

process.once('exit', () => { if (persistentWorker) persistentWorker.stop(); });
process.once('SIGINT', () => { if (persistentWorker) persistentWorker.stop(); process.exit(130); });
process.once('SIGTERM', () => { if (persistentWorker) persistentWorker.stop(); process.exit(143); });
