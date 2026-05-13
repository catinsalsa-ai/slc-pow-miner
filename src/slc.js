import { ethers } from 'ethers';
import { SLC_ADDRESS } from './config.js';

export const SLC_ABI = [
  'function mineParams() view returns (bytes32 epochSeed, uint256 target, uint256 reward, uint8 epoch, bool poolLive)',
  'function commit(bytes32 commitment) external',
  'function reveal(uint256 nonce, bytes32 secret, uint256 anchorBlock) external',
  'function totalMined() view returns (uint256)',
  'function currentReward() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export function provider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl, 1, { staticNetwork: ethers.Network.from(1) });
}

export function contract(readOrSigner) {
  return new ethers.Contract(SLC_ADDRESS, SLC_ABI, readOrSigner);
}

export function fmtEth(x) { return ethers.formatEther(x); }
export function fmtGwei(x) { return ethers.formatUnits(x, 'gwei'); }
export function fmtSlc(x) { return ethers.formatUnits(x, 18); }

export function challenge(anchorHash, epochSeed) {
  return ethers.keccak256(ethers.concat([anchorHash, epochSeed]));
}

export function proofHash(challengeBytes32, minerAddress, nonce) {
  return ethers.solidityPackedKeccak256(['bytes32', 'address', 'uint256'], [challengeBytes32, minerAddress, nonce]);
}

export function commitment(nonce, secret, minerAddress, anchorBlock) {
  return ethers.solidityPackedKeccak256(['uint256', 'bytes32', 'address', 'uint256'], [nonce, secret, minerAddress, anchorBlock]);
}

export function hashBeatsTarget(hashHex, target) {
  return BigInt(hashHex) < BigInt(target);
}

export async function getDexPriceUsd() {
  const url = `https://api.dexscreener.com/tokens/v1/ethereum/${SLC_ADDRESS}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const pairs = await res.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    const best = pairs.filter(p => p?.priceUsd).sort((a,b)=>(b?.liquidity?.usd||0)-(a?.liquidity?.usd||0))[0];
    if (!best) return null;
    return { priceUsd: best.priceUsd, liquidityUsd: best?.liquidity?.usd ?? null, url: best.url ?? null };
  } catch { return null; }
}

export async function gasSnapshot(p) {
  const fee = await p.getFeeData();
  const block = await p.getBlock('latest');
  const gasPrice = fee.gasPrice ?? block.baseFeePerGas ?? 0n;
  return { fee, block, gasPrice, gasGwei: Number(fmtGwei(gasPrice)) };
}

export async function mineParams(c) {
  const [epochSeed, target, reward, epoch, poolLive] = await c.mineParams();
  return { epochSeed, target, reward, epoch, poolLive };
}
