import fs from 'fs';
import path from 'path';
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

export async function cudaSearchOnce({ ch, target, miner, startNonce }) {
  const bin = findCudaBinary();
  if (!bin) {
    throw new Error('CUDA binary not found. Run: npm run build:cuda');
  }
  const start = asUint64Decimal(startNonce ?? BigInt('0x' + Buffer.from(ethers.randomBytes(8)).toString('hex')));
  const batch = String(config.cudaBatch);
  const args = [strip0x(ch), strip0x(miner), strip0x(ethers.toBeHex(target, 32)), start, batch];
  const started = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      let msg;
      try { msg = JSON.parse(line); }
      catch (e) { reject(new Error(`CUDA JSON parse failed: ${line}`)); return; }

      const tried = Number(msg.tried || config.cudaBatch);
      const dt = Math.max(0.001, (Date.now() - started) / 1000);
      const base = { backend: 'cuda', tried, hps: Number(msg.hps || tried / dt), device: msg.device || 'CUDA GPU' };
      if (msg.type !== 'found') {
        resolve({ found: false, ...base });
        return;
      }
      const cpuHash = proofHash(ch, miner, BigInt(msg.nonce));
      if (cpuHash.toLowerCase() !== String(msg.hash).toLowerCase()) {
        reject(new Error(`CUDA self-check mismatch nonce=${msg.nonce} gpu=${msg.hash} cpu=${cpuHash}`));
        return;
      }
      if (!hashBeatsTarget(cpuHash, target)) {
        reject(new Error(`CUDA nonce failed target check nonce=${msg.nonce} hash=${cpuHash}`));
        return;
      }
      resolve({ found: true, nonce: msg.nonce, hash: cpuHash, ...base });
    });
  });
}
