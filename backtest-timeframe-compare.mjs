// Compare 1m vs 2m vs 5m for ICT v3 + Rejection Zones
const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50;
const FIXED_SL = 1.00;
const ZONE_TOLERANCE = 0.15;

async function fetchYahoo(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getMinET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }
function ema(a, p) { if (!a || a.length < p) return []; const k = 2 / (p + 1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i] * k + e[i - 1] * (1 - k) : e[i - 1]); return e; }
function vwapCalc(h, l, c, v) { const vw = []; let n = 0, d = 0; for (let i = 0; i < c.length; i++) { if (h[i] != null && l[i] != null && c[i] != null && v[i] != null) { n += ((h[i] + l[i] + c[i]) / 3) * v[i]; d += v[i]; } vw.push(d ? +(n / d).toFixed(4) : null); } return vw; }

function swingLevels(h, l, start, end) {
  const levels = [];
  for (let i = Math.max(start + 1, 2); i < end - 1; i++) {
    if (h[i] != null && h[i - 1] != null && h[i + 1] != null && h[i] > h[i - 1] && h[i] > h[i + 1]) levels.push({ type: 'HIGH', price: h[i], idx: i });
    if (l[i] != null && l[i - 1] != null && l[i + 1] != null && l[i] < l[i - 1] && l[i] < l[i + 1]) levels.push({ type: 'LOW', price: l[i], idx: i });
  }
  return levels;
}

function filterDay(data, dateStr, minFrom, minTo) {
  const idx = [];
  for (let i = 0; i < data.timestamps.length; i++) {
    if (getDateET(data.timestamps[i]) !== dateStr) continue;
    const m = getMinET(data.timestamps[i]);
    if (m >= minFrom && m < minTo) idx.push(i);
  }
  return idx;
}

function detectRejectionZones(h, l, o, c, startIdx, endIdx) {
  const rejections = [];
  for (let i = startIdx; i < endIdx; i++) {
    if (!h[i] || !l[i] || !o[i] || !c[i]) continue;
    const body = Math.abs(c[i] - o[i]);
    const totalRange = h[i] - l[i];
    if (totalRange < 0.01) continue;
    const wickDown = Math.min(o[i], c[i]) - l[i];
    const wickUp = h[i] - Math.max(o[i], c[i]);
    if (wickDown > body * 0.8 && wickDown > totalRange * 0.4)
      rejections.push({ price: +l[i].toFixed(2), type: 'DEMAND', idx: i, wickSize: +wickDown.toFixed(2) });
    if (wickUp > body * 0.8 && wickUp > totalRange * 0.4)
      rejections.push({ price: +h[i].toFixed(2), type: 'SUPPLY', idx: i, wickSize: +wickUp.toFixed(2) });
  }
  const zones = []; const used = new Set();
  for (let i = 0; i < rejections.length; i++) {
    if (used.has(i)) continue;
    const cluster = [rejections[i]]; used.add(i);
    for (let j = i + 1; j < rejections.length; j++) {
      if (used.has(j)) continue;
      if (rejections[j].type === rejections[i].type && Math.abs(rejections[j].price - rejections[i].price) <= ZONE_TOLERANCE) { cluster.push(rejections[j]); used.add(j); }
    }
    const avgPrice = +(cluster.reduce((s, r) => s + r.price, 0) / cluster.length).toFixed(2);
    zones.push({ price: avgPrice, type: cluster[0].type, count: cluster.length, confirmed: cluster.length >= 2, strength: cluster.length >= 3 ? 'STRONG' : cluster.length >= 2 ? 'MODERATE' : 'WEAK' });
  }
  return zones;
}

function nearZone(price, zones, type, tolerance = 0.50) {
  for (const z of zones) { if (z.type === type && z.confirmed && Math.abs(price - z.price) <= tolerance) return z; }
  return null;
}

function slInZone(sl, zones, dir) {
  const type = dir === 'CALL' ? 'DEMAND' : 'SUPPLY';
  for (const z of zones) { if (z.type === type && z.confirmed && Math.abs(sl - z.price) <= 0.25) return z; }
  return null;
}

function backtestDay(dateStr, dataSetup, data1h, spyD, vixD, ticker) {
  const trades = [];
  if (!dataSetup) return trades;

  // 1H Bias
  const idx1h = data1h ? filterDay(data1h, dateStr, 570, 960) : [];
  let bias1h = 'NEUTRAL';
  if (idx1h.length >= 2) {
    const cc = idx1h.map(i => data1h.closes[i]), hh = idx1h.map(i => data1h.highs[i]), ll = idx1h.map(i => data1h.lows[i]), vv = idx1h.map(i => data1h.volumes[i]);
    const vw = vwapCalc(hh, ll, cc, vv); const e3 = ema(cc, 3); const len = cc.length;
    if (cc[len-1] > vw[len-1] && cc[len-1] > e3[len-1]) bias1h = 'BULLISH';
    else if (cc[len-1] < vw[len-1] && cc[len-1] < e3[len-1]) bias1h = 'BEARISH';
  }
  if (bias1h === 'NEUTRAL') return trades;

  const idx = filterDay(dataSetup, dateStr, 570, 960);
  if (idx.length < 20) return trades;
  const h = idx.map(i => dataSetup.highs[i]), l = idx.map(i => dataSetup.lows[i]);
  const c = idx.map(i => dataSetup.closes[i]), o = idx.map(i => dataSetup.opens[i]);
  const v = idx.map(i => dataSetup.volumes[i]);
  const vw = vwapCalc(h, l, c, v);
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const len = c.length;

  const confIdx = Math.min(12, len - 1);
  const trendAligned = bias1h === 'BULLISH' ? (e9[confIdx] > e21[confIdx] && c[confIdx] > vw[confIdx])
    : (e9[confIdx] < e21[confIdx] && c[confIdx] < vw[confIdx]);
  const levels15 = swingLevels(h, l, 0, Math.min(confIdx + 5, len));

  let inTrade = false;

  for (let j = Math.max(8, confIdx + 1); j < len - 3; j++) {
    if (inTrade) continue;
    const candleMin = getMinET(dataSetup.timestamps[idx[j]]);
    if (!((candleMin >= 575 && candleMin <= 660) || (candleMin >= 840 && candleMin <= 930))) continue;
    const kz = candleMin <= 660 ? 'MORNING' : 'POWER_HOUR';
    const price = c[j]; if (!price) continue;
    const vwapNow = vw[j];
    const vwapOk = bias1h === 'BULLISH' ? price > vwapNow : price < vwapNow;
    if (!vwapOk) continue;

    const zones = detectRejectionZones(h, l, o, c, Math.max(0, j - 40), j);
    const confirmedZones = zones.filter(z => z.confirmed);
    const levels5 = swingLevels(h, l, Math.max(0, j - 20), j);
    const allLevels = [...levels5, ...levels15];

    let sweep = null;
    for (let k = Math.max(j - 3, 0); k <= j; k++) {
      if (!c[k] || !o[k] || !h[k] || !l[k]) continue;
      const body = Math.abs(c[k] - o[k]);
      const wickDn = Math.min(c[k], o[k]) - l[k], wickUp = h[k] - Math.max(c[k], o[k]);
      for (const lv of allLevels) {
        if (lv.type === 'LOW' && l[k] < lv.price && c[k] > lv.price && wickDn > body * 0.5) sweep = { type: 'BULL', candleIdx: k };
        if (lv.type === 'HIGH' && h[k] > lv.price && c[k] < lv.price && wickUp > body * 0.5) sweep = { type: 'BEAR', candleIdx: k };
      }
    }
    if (sweep && bias1h === 'BULLISH' && sweep.type !== 'BULL') continue;
    if (sweep && bias1h === 'BEARISH' && sweep.type !== 'BEAR') continue;

    let mss = false;
    if (sweep) {
      const si = sweep.candleIdx;
      if (sweep.type === 'BULL') { let rh = -Infinity; for (let k = Math.max(0, si-10); k < si; k++) { if (h[k] > rh) rh = h[k]; } for (let k = si+1; k <= Math.min(j, si+12); k++) { if (h[k] > rh) { mss = true; break; } } }
      else { let rl = Infinity; for (let k = Math.max(0, si-10); k < si; k++) { if (l[k] < rl) rl = l[k]; } for (let k = si+1; k <= Math.min(j, si+12); k++) { if (l[k] < rl) { mss = true; break; } } }
    }

    let fvg = false;
    for (let k = Math.max(2, j-4); k <= j; k++) { if (h[k] && l[k] && h[k-2] && l[k-2]) { if (l[k] > h[k-2] && (l[k]-h[k-2]) > 0.03) fvg = true; if (h[k] < l[k-2] && (l[k-2]-h[k]) > 0.03) fvg = true; } }

    let displacement = false;
    const avgBody = c.slice(Math.max(0,j-10),j).reduce((s,c2,i2) => s + Math.abs((c2||0) - (o[Math.max(0,j-10)+i2]||0)), 0) / 10;
    for (let k = Math.max(1,j-2); k <= j; k++) { if (o[k] && c[k] && Math.abs(c[k]-o[k]) > avgBody * 1.5) displacement = true; }

    let vwapReclaim = false;
    if (j >= 4 && vw[j-3] && vw[j]) {
      if (c[j-3] < vw[j-3] && c[j-2] < vw[j-2] && c[j] > vw[j] && bias1h === 'BULLISH') vwapReclaim = true;
      if (c[j-3] > vw[j-3] && c[j-2] > vw[j-2] && c[j] < vw[j] && bias1h === 'BEARISH') vwapReclaim = true;
    }

    let setupType = 'NONE';
    if (sweep && mss && (fvg || displacement)) setupType = 'SWEEP_MSS_FVG';
    else if (sweep && mss) setupType = 'SWEEP_MSS';
    else if (vwapReclaim && displacement) setupType = 'VWAP_RECLAIM';
    else if (sweep && displacement) setupType = 'SWEEP_DISP';
    if (setupType === 'NONE') continue;

    const targetTs = dataSetup.timestamps[idx[j]];
    let spyOk = false, vixOk = false;
    if (spyD) { let si = -1; for (let i = spyD.timestamps.length-1; i >= 0; i--) { if (spyD.timestamps[i] <= targetTs) { si = i; break; } } if (si >= 3 && spyD.closes[si] != null && spyD.closes[si-3] != null) { const chg = spyD.closes[si] - spyD.closes[si-3]; spyOk = bias1h === 'BULLISH' ? chg > 0 : chg < 0; } }
    if (vixD) { let vi = -1; for (let i = vixD.timestamps.length-1; i >= 0; i--) { if (vixD.timestamps[i] <= targetTs) { vi = i; break; } } if (vi >= 3 && vixD.closes[vi] != null && vixD.closes[vi-3] != null) { const chg = vixD.closes[vi] - vixD.closes[vi-3]; vixOk = bias1h === 'BULLISH' ? chg < 0 : chg > 0; } }

    const avgVol = v.slice(Math.max(0,j-20),j).filter(x => x > 0).reduce((a,b) => a+b, 0) / 20;
    const rvol = avgVol ? +((v[j]||0)/avgVol).toFixed(2) : 0;

    const dir = bias1h === 'BULLISH' ? 'CALL' : 'PUT';
    let score = 1; // bias
    if (trendAligned) score += 1;
    if (sweep) score += 2; if (mss) score += 2;
    if (vwapOk) score += 1; if (fvg) score += 1; if (displacement) score += 1;
    if (vwapReclaim) score += 1; if (spyOk) score += 1; if (vixOk) score += 1;
    if (rvol >= 1.5) score += 1;

    const nearType = dir === 'CALL' ? 'DEMAND' : 'SUPPLY';
    const near = nearZone(price, confirmedZones, nearType, 0.50);
    if (near) score += near.strength === 'STRONG' ? 2 : 1;

    if (score < 5) continue;

    let sl = dir === 'CALL' ? +(price - FIXED_SL).toFixed(2) : +(price + FIXED_SL).toFixed(2);
    const slZone = slInZone(sl, confirmedZones, dir);
    let slAdjusted = false;
    if (slZone) {
      sl = dir === 'CALL' ? +(slZone.price - 0.15).toFixed(2) : +(slZone.price + 0.15).toFixed(2);
      slAdjusted = true;
    }
    const slDist = Math.abs(price - sl);
    if (slDist > 2.00) continue;

    const entry = +price.toFixed(2);
    const tp = dir === 'CALL' ? +(entry + slDist * 3).toFixed(2) : +(entry - slDist * 3).toFixed(2);
    let exitPrice = null, resultado = 'CIERRE';
    for (let f = j+1; f < len; f++) {
      if (dir === 'CALL') { if (l[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; } if (h[f] >= tp) { exitPrice = tp; resultado = 'TARGET'; break; } }
      else { if (h[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; } if (l[f] <= tp) { exitPrice = tp; resultado = 'TARGET'; break; } }
    }
    if (!exitPrice) { exitPrice = c[len-1] || entry; }
    const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
    const hora = new Date(dataSetup.timestamps[idx[j]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

    trades.push({ fecha: dateStr, hora, ticker, dir, entry, sl, tp, exit: +exitPrice.toFixed(2), pnl, pnlC: +(pnl*DOLLAR_PER_MOVE).toFixed(0), resultado, score, kz, setupType, slAdjusted, hasZone: !!near });
    inTrade = true;
  }
  return trades;
}

function summarize(trades) {
  const w = trades.filter(t => t.pnl > 0), lo = trades.filter(t => t.pnl < 0);
  const tc = trades.reduce((s,t) => s+t.pnlC, 0);
  const wr = trades.length ? (w.length/trades.length*100).toFixed(0) : 0;
  const pf = lo.length && lo.reduce((s,t) => s+t.pnlC, 0) !== 0 ? Math.abs(w.reduce((s,t) => s+t.pnlC, 0) / lo.reduce((s,t) => s+t.pnlC, 0)).toFixed(2) : '∞';
  return { total: trades.length, wins: w.length, losses: lo.length, wr, totalC: tc, pf };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTimeframe(interval, range, label) {
  console.log(`\n── Fetching ${label} (${interval}, ${range}) ──`);
  const data = {}, data1h = {};
  for (const t of TICKERS) {
    process.stdout.write(`  ${t}...`);
    data[t] = await fetchYahoo(t, interval, range);
    await sleep(500);
    data1h[t] = await fetchYahoo(t, '1h', range);
    await sleep(500);
    console.log(data[t] ? ` ✅ (${data[t].timestamps.length})` : ' ⚠️');
  }
  const spyD = data['SPY'] || await fetchYahoo('SPY', interval, range);
  await sleep(800);
  const vixD = await fetchYahoo('^VIX', interval, range);
  await sleep(1000);

  const allTs = [];
  for (const t of TICKERS) { if (data[t]) allTs.push(...data[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();

  const allTrades = [];
  for (const d of dates) {
    for (const ticker of TICKERS) {
      const dt = backtestDay(d, data[ticker], data1h[ticker], spyD, vixD, ticker);
      allTrades.push(...dt);
    }
  }

  const s = summarize(allTrades);

  // Per ticker
  const perTicker = {};
  for (const tk of TICKERS) {
    const dt = allTrades.filter(t => t.ticker === tk);
    if (dt.length > 0) perTicker[tk] = summarize(dt);
  }

  // Zone impact
  const withZone = summarize(allTrades.filter(t => t.hasZone));
  const withoutZone = summarize(allTrades.filter(t => !t.hasZone));
  const slAdj = summarize(allTrades.filter(t => t.slAdjusted));

  // Drawdown
  let peak = 0, maxDD = 0, run = 0;
  for (const t of allTrades) { run += t.pnlC; if (run > peak) peak = run; if (peak-run > maxDD) maxDD = peak-run; }

  // Win days
  let posDays = 0, negDays = 0;
  for (const d of dates) { const dt = allTrades.filter(t => t.fecha === d); if (dt.length === 0) continue; const dp = dt.reduce((s,t) => s+t.pnlC, 0); if (dp >= 0) posDays++; else negDays++; }

  return { label, interval, range, dates: dates.length, ...s, perTicker, withZone, withoutZone, slAdj, maxDD, posDays, negDays, trades: allTrades };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION 1M vs 2M vs 5M — ICT v3 + Rejection Zones');
  console.log('  Tickers: ' + TICKERS.join(', '));
  console.log('═══════════════════════════════════════════════════════════════════');

  const results = [];

  // Run sequentially with big pause between
  results.push(await runTimeframe('2m', '60d', '2min (60 dias)'));
  console.log('\n⏳ Waiting 10s before next timeframe...');
  await sleep(10000);
  results.push(await runTimeframe('5m', '60d', '5min (60 dias)'));
  console.log('\n⏳ Waiting 10s before next timeframe...');
  await sleep(10000);
  results.push(await runTimeframe('1m', '5d', '1min (5 dias)'));

  // COMPARISON TABLE
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('  RESULTADOS');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log(`${'TF'.padEnd(18)} ${'Dias'.padEnd(6)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(5)} ${'L'.padEnd(5)} ${'PnL'.padEnd(10)} ${'PF'.padEnd(6)} ${'DD'.padEnd(6)} ${'WinDays'.padEnd(8)} ${'Trades/d'.padEnd(9)} Cuenta`);
  console.log('─'.repeat(105));

  for (const r of results) {
    const pnlStr = (r.totalC >= 0 ? '+$' : '-$') + Math.abs(r.totalC);
    const tpd = (r.total / r.dates).toFixed(1);
    const wd = r.posDays + r.negDays > 0 ? Math.round(r.posDays / (r.posDays + r.negDays) * 100) + '%' : '—';
    console.log(`${r.label.padEnd(18)} ${String(r.dates).padEnd(6)} ${String(r.total).padEnd(8)} ${(r.wr+'%').padEnd(6)} ${String(r.wins).padEnd(5)} ${String(r.losses).padEnd(5)} ${pnlStr.padEnd(10)} ${r.pf.padEnd(6)} $${String(r.maxDD).padEnd(5)} ${wd.padEnd(8)} ${tpd.padEnd(9)} $${(2000 + r.totalC).toLocaleString()}`);
  }

  // Normalize to per-day for fair comparison
  console.log('\n── Normalizado por dia (para comparar 5d vs 60d) ──');
  for (const r of results) {
    const pnlPerDay = (r.totalC / r.dates).toFixed(0);
    const tradesPerDay = (r.total / r.dates).toFixed(1);
    console.log(`  ${r.label.padEnd(18)}: ${pnlPerDay >= 0 ? '+' : ''}$${pnlPerDay}/dia | ${tradesPerDay} trades/dia | ${r.wr}% WR | PF ${r.pf}`);
  }

  // Per ticker comparison
  console.log('\n── Por Ticker (WR%) ──');
  console.log(`${'Ticker'.padEnd(7)} ${results.map(r => r.label.padEnd(20)).join('')}`);
  console.log('─'.repeat(67));
  for (const tk of TICKERS) {
    let line = tk.padEnd(7);
    for (const r of results) {
      const s = r.perTicker[tk];
      line += s ? `${s.wr}% WR (${s.total}t, PF ${s.pf})`.padEnd(20) : '—'.padEnd(20);
    }
    console.log(line);
  }

  // Zone impact comparison
  console.log('\n── Rejection Zones Impact ──');
  for (const r of results) {
    console.log(`  ${r.label}:`);
    console.log(`    Con zona:     ${r.withZone.total} trades | ${r.withZone.wr}% WR | PF ${r.withZone.pf}`);
    console.log(`    Sin zona:     ${r.withoutZone.total} trades | ${r.withoutZone.wr}% WR | PF ${r.withoutZone.pf}`);
    console.log(`    SL ajustado:  ${r.slAdj.total} trades | ${r.slAdj.wr}% WR | PF ${r.slAdj.pf}`);
  }

  // Winner
  const best = results.reduce((a, b) => {
    const aPd = a.totalC / a.dates, bPd = b.totalC / b.dates;
    return aPd > bPd ? a : b;
  });
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  GANADOR: ${best.label}`);
  console.log(`  ${best.wr}% WR | PF ${best.pf} | +$${(best.totalC / best.dates).toFixed(0)}/dia`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);
}

main().catch(e => console.error('Error:', e.message));
