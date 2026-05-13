import os from 'os';
import { ethers } from 'ethers';
import { proofHash } from './slc.js';

const miner = ethers.Wallet.createRandom().address;
const challenge = ethers.keccak256(ethers.randomBytes(32));
const n = 100000;
const t0 = Date.now();
for (let i = 0n; i < BigInt(n); i++) proofHash(challenge, miner, i);
const dt = (Date.now() - t0) / 1000;
console.log(`CPU JS bench: ${(n / dt).toFixed(0)} hashes/s single thread`);
console.log(`CPU cores detected: ${os.cpus().length}`);
console.log('Note: this MVP uses JS CPU hashing. Native/GPU backend can be added after read-only status is verified.');
