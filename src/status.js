import { ethers } from 'ethers';
import { config, SLC_ADDRESS } from './config.js';
import { provider, contract, mineParams, fmtEth, fmtGwei, fmtSlc, getDexPriceUsd, gasSnapshot } from './slc.js';

const p = provider(config.rpcUrl);
const c = contract(p);

console.log('SLC miner status (read-only)');
console.log(`Contract: ${SLC_ADDRESS}`);
console.log(`RPC: ${config.rpcUrl}`);

const [network, params, total, reward, gas, price] = await Promise.all([
  p.getNetwork(),
  mineParams(c),
  c.totalMined().catch(() => null),
  c.currentReward().catch(() => null),
  gasSnapshot(p),
  getDexPriceUsd(),
]);

console.log(`Chain ID: ${network.chainId}`);
console.log(`Pool live: ${params.poolLive}`);
console.log(`Epoch: ${params.epoch}`);
console.log(`Target: ${params.target.toString()}`);
console.log(`Reward: ${fmtSlc(params.reward)} SLC`);
if (total !== null) console.log(`Total mined: ${fmtSlc(total)} SLC`);
if (reward !== null) console.log(`Current reward: ${fmtSlc(reward)} SLC`);
console.log(`Latest block: ${gas.block.number}`);
console.log(`Gas price: ${fmtGwei(gas.gasPrice)} gwei`);
console.log(`Max gas cap: ${config.maxGasGwei} gwei`);
console.log(`Budget: ${config.budgetEth} ETH`);
if (price) console.log(`DEX Screener: $${price.priceUsd}/SLC liquidity=$${price.liquidityUsd ?? 'n/a'} ${price.url ?? ''}`);
else console.log('DEX Screener: price not indexed / unavailable');

if (config.privateKey) {
  const wallet = new ethers.Wallet(config.privateKey, p);
  const [ethBal, slcBal] = await Promise.all([p.getBalance(wallet.address), c.balanceOf(wallet.address).catch(() => null)]);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Wallet ETH: ${fmtEth(ethBal)} ETH`);
  if (slcBal !== null) console.log(`Wallet SLC: ${fmtSlc(slcBal)} SLC`);
} else {
  console.log('Wallet: not configured (status works without PRIVATE_KEY)');
}
