import { parentPort, workerData } from 'worker_threads';
import { proofHash, hashBeatsTarget } from './slc.js';

const { challenge, miner, target, start, stride, batchSize } = workerData;
let nonce = BigInt(start);
const step = BigInt(stride);
let tried = 0;
const startTime = Date.now();

for (let i = 0; i < batchSize; i++) {
  const h = proofHash(challenge, miner, nonce);
  tried++;
  if (hashBeatsTarget(h, target)) {
    parentPort.postMessage({ found: true, nonce: nonce.toString(), hash: h, tried, ms: Date.now() - startTime });
    process.exit(0);
  }
  nonce += step;
}
parentPort.postMessage({ found: false, tried, ms: Date.now() - startTime });
