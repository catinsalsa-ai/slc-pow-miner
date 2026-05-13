import { fmtEth, fmtSlc } from './slc.js';

export const REPORT_ENDPOINT = 'https://svwobzsafxhhndcojmia.supabase.co/functions/v1/report';
export const REPORT_API_KEY = 'sb_publishable_jdBUhy2g2k1BB0oOtNy04Q_Bj9P_B1v';

function cleanName(name) {
  const n = String(name || '').trim();
  return n ? n.slice(0, 32) : undefined;
}

function cleanClient(client) {
  const c = String(client || '').trim();
  return c ? c.slice(0, 48) : undefined;
}

function finiteNumber(n) {
  return Number.isFinite(n) ? n : undefined;
}

export function reportingEnabled(config) {
  return !['off', 'false', '0', 'no'].includes(String(config.report || 'off').trim().toLowerCase());
}

export async function sendReport(wallet, stats) {
  try {
    const payload = {
      v: 1,
      addr: wallet.address.toLowerCase(),
      ts: Date.now(),
      chain: 1,
      name: cleanName(stats.name),
      client: cleanClient(stats.client || 'slc-pow-miner/0.1.0'),
      workers: finiteNumber(stats.workers),
      hps: finiteNumber(stats.hps),
      epoch: finiteNumber(stats.epoch),
      wins: finiteNumber(stats.wins),
      minedSlc: stats.minedSlc,
      balanceSlc: stats.balanceSlc,
      gasEth: stats.gasEth,
      budgetEth: stats.budgetEth,
      walletEth: stats.walletEth,
      lastWinTx: stats.lastWinTx,
      lastWinBlock: finiteNumber(stats.lastWinBlock),
      lastWinAt: finiteNumber(stats.lastWinAt),
    };

    // Drop undefined/null/empty fields so the server receives only clean telemetry.
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null || v === '') delete payload[k];
    }

    const report = JSON.stringify(payload);
    const signature = await wallet.signMessage(report);
    const res = await fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: REPORT_API_KEY },
      body: JSON.stringify({ report, signature }),
    });
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => '') };
    return await res.json().catch(() => ({ ok: true }));
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function buildReportStats({ p, c, wallet, config, startEth, startSlc, hps, epoch, wins, lastWin }) {
  const [ethBal, slcBal] = await Promise.all([
    p.getBalance(wallet.address),
    c.balanceOf(wallet.address).catch(() => null),
  ]);
  const gasSpent = startEth > ethBal ? startEth - ethBal : 0n;
  const mined = slcBal !== null && slcBal > startSlc ? slcBal - startSlc : 0n;
  return {
    name: config.minerName,
    client: 'slc-pow-miner/0.1.0',
    workers: config.gpu ? 1 : (config.workers || undefined),
    hps,
    epoch,
    wins,
    minedSlc: fmtSlc(mined),
    balanceSlc: slcBal === null ? undefined : fmtSlc(slcBal),
    gasEth: fmtEth(gasSpent),
    budgetEth: config.budgetCapEnabled ? String(config.budgetEth) : '0',
    walletEth: fmtEth(ethBal),
    lastWinTx: lastWin?.tx,
    lastWinBlock: lastWin?.block,
    lastWinAt: lastWin?.at,
  };
}
