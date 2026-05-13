import 'dotenv/config';

export const SLC_ADDRESS = '0xbb572707D09eB2E80C835D3051097E5083D460Cc';

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const budgetEth = numEnv('BUDGET_ETH', 0.003);

export const config = {
  rpcUrl: process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com',
  privateKey: (process.env.PRIVATE_KEY || '').trim(),
  budgetEth,
  budgetCapEnabled: budgetEth > 0,
  maxGasGwei: numEnv('MAX_GAS_GWEI', 3),
  priorityFeeGwei: numEnv('PRIORITY_FEE_GWEI', 0.2),
  runTx: boolEnv('RUN_TX', false),
  workers: Math.max(0, Math.floor(numEnv('WORKERS', 0))),
  batchSize: Math.max(1000, Math.floor(numEnv('BATCH_SIZE', 50000))),
  gpu: boolEnv('GPU', false),
  cudaBatch: Math.max(1024, Math.floor(numEnv('CUDA_BATCH', 4_194_304))),
  anchorRefreshBlocks: Math.max(1, Math.floor(numEnv('ANCHOR_REFRESH_BLOCKS', 20))),
  report: (process.env.REPORT || 'off').toLowerCase(),
  minerName: process.env.MINER_NAME || 'slc-miner',
};

export function requireBurnerKey() {
  if (!config.privateKey) throw new Error('PRIVATE_KEY missing. Put a burner wallet key in local .env only.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.privateKey)) throw new Error('PRIVATE_KEY must be 0x + 64 hex chars.');
  return config.privateKey;
}
