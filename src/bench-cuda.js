import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bin = process.env.CUDA_MINER_BIN || path.join(root, 'bin', 'slc-cuda');

if (!existsSync(bin)) {
  console.error('CUDA binary not found. Run: npm run build:cuda');
  process.exit(1);
}

const challenge = '0x0000000000000000000000000000000000000000000000000000000000000000';
const miner = '0x0000000000000000000000000000000000000000';
// Very hard target so normal benchmark does not hit early and skew hps.
const target = '0x0000000000000000000000000000000000000000000000000000000000000000';
const batch = process.env.CUDA_BENCH_BATCH || '67108864';
const cases = [
  { CUDA_THREADS: '128', CUDA_BLOCKS_MULT: '64' },
  { CUDA_THREADS: '128', CUDA_BLOCKS_MULT: '128' },
  { CUDA_THREADS: '256', CUDA_BLOCKS_MULT: '64' },
  { CUDA_THREADS: '256', CUDA_BLOCKS_MULT: '128' },
  { CUDA_THREADS: '256', CUDA_BLOCKS_MULT: '256' },
  { CUDA_THREADS: '512', CUDA_BLOCKS_MULT: '64' },
  { CUDA_THREADS: '512', CUDA_BLOCKS_MULT: '128' },
];

function fmt(hps) {
  if (!Number.isFinite(hps)) return '0 H/s';
  if (hps >= 1e9) return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6) return `${(hps / 1e6).toFixed(1)} MH/s`;
  return `${Math.round(hps).toLocaleString()} H/s`;
}

console.log('SLC CUDA launch benchmark');
console.log(`Binary: ${bin}`);
console.log(`Batch : ${Number(batch).toLocaleString()} nonces/case`);
console.log('');

const rows = [];
for (const c of cases) {
  const env = { ...process.env, ...c };
  const run = spawnSync(bin, [challenge, miner, target, '1', batch], { encoding: 'utf8', env, timeout: 180000 });
  if (run.status !== 0) {
    rows.push({ ...c, ok: false, error: (run.stderr || run.stdout || '').trim().slice(0, 120) });
    continue;
  }
  try {
    const j = JSON.parse(run.stdout.trim().split(/\r?\n/).filter(Boolean).pop());
    rows.push({ ...c, ok: true, hps: Number(j.hps || 0), ms: Number(j.ms || 0), blocks: j.blocks, threads: j.threads, device: j.device });
  } catch (err) {
    rows.push({ ...c, ok: false, error: `parse failed: ${err.message}` });
  }
}

rows.sort((a, b) => (b.hps || 0) - (a.hps || 0));
for (const r of rows) {
  if (!r.ok) {
    console.log(`❌ threads=${r.CUDA_THREADS} mult=${r.CUDA_BLOCKS_MULT} | ${r.error}`);
  } else {
    console.log(`✅ ${fmt(r.hps).padStart(12)} | ${String(r.ms.toFixed(1)).padStart(8)} ms | launch=${r.blocks}x${r.threads} | env CUDA_THREADS=${r.CUDA_THREADS} CUDA_BLOCKS_MULT=${r.CUDA_BLOCKS_MULT}`);
  }
}

const best = rows.find(r => r.ok);
if (best) {
  console.log('');
  console.log('Best .env / command override:');
  console.log(`CUDA_THREADS=${best.CUDA_THREADS}`);
  console.log(`CUDA_BLOCKS_MULT=${best.CUDA_BLOCKS_MULT}`);
}
