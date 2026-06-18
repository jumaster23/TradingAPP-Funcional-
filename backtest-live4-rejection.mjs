// Backtest ICT Smart Money v3 + Rejection Zones — 60 days
// Rejection = wick > body at same level 2+ times = confirmed zone
const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50;
const FIXED_SL = 1.00;
const ZONE_TOLERANCE = 0.15; // $0.15 tolerance for zone matching

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

// ═══════════════════════════════════════════════════
// REJECTION ZONE DETECTION
// ═══════════════════════════════════════════════════
function detectRejectionZones(h, l, o, c, startIdx, endIdx) {
  const rejections = []; // { price, type: 'DEMAND'|'SUPPLY', count, strength }

  for (let i = startIdx; i < endIdx; i++) {
    if (!h[i] || !l[i] || !o[i] || !c[i]) continue;
    const body = Math.abs(c[i] - o[i]);
    const totalRange = h[i] - l[i];
    if (totalRange < 0.01) continue;

    const wickDown = Math.min(o[i], c[i]) - l[i];
    const wickUp = h[i] - Math.max(o[i], c[i]);

    // Demand zone: long wick down (rejection of lower prices)
    if (wickDown > body * 0.8 && wickDown > totalRange * 0.4) {
      rejections.push({ price: +l[i].toFixed(2), type: 'DEMAND', idx: i, wickSize: +wickDown.toFixed(2) });
    }
    // Supply zone: long wick up (rejection of higher prices)
    if (wickUp > body * 0.8 && wickUp > totalRange * 0.4) {
      rejections.push({ price: +h[i].toFixed(2), type: 'SUPPLY', idx: i, wickSize: +wickUp.toFixed(2) });
    }
  }

  // Cluster rejections at same price level (within tolerance)
  const zones = [];
  const used = new Set();

  for (let i = 0; i < rejections.length; i++) {
    if (used.has(i)) continue;
    const cluster = [rejections[i]];
    used.add(i);

    for (let j = i + 1; j < rejections.length; j++) {
      if (used.has(j)) continue;
      if (rejections[j].type === rejections[i].type && Math.abs(rejections[j].price - rejections[i].price) <= ZONE_TOLERANCE) {
        cluster.push(rejections[j]);
        used.add(j);
      }
    }

    const avgPrice = +(cluster.reduce((s, r) => s + r.price, 0) / cluster.length).toFixed(2);
    const totalWick = +cluster.reduce((s, r) => s + r.wickSize, 0).toFixed(2);

    zones.push({
      price: avgPrice,
      type: cluster[0].type,
      count: cluster.length,
      confirmed: cluster.length >= 2, // 2+ rejections = confirmed
      strength: cluster.length >= 3 ? 'STRONG' : cluster.length >= 2 ? 'MODERATE' : 'WEAK',
      totalWick,
      lastIdx: Math.max(...cluster.map(r => r.idx)),
    });
  }

  return zones.sort((a, b) => b.count - a.count);
}

// Check if price is near a rejection zone
function nearZone(price, zones, type, tolerance = 0.30) {
  for (const z of zones) {
    if (z.type === type && Math.abs(price - z.price) <= tolerance) return z;
  }
  return null;
}

// Check if SL would land inside a demand/supply zone
function slInZone(sl, zones, dir) {
  // For CALL: SL is below entry — check if it lands in a demand zone (price bounces there = bad SL)
  // For PUT: SL is above entry — check if it lands in a supply zone
  const type = dir === 'CALL' ? 'DEMAND' : 'SUPPLY';
  for (const z of zones) {
    if (z.type === type && z.confirmed && Math.abs(sl - z.price) <= 0.25) return z;
  }
  return null;
}

async function backtestDay(dateStr, data5m, data1h, spyD, vixD, ticker) {
  const trades = [];
  const d5 = data5m[ticker];
  const d1h = data1h[ticker];
  if (!d5) return trades;

  // 1H Bias
  const idx1h = d1h ? filterDay(d1h, dateStr, 570, 960) : [];
  let bias1h = 'NEUTRAL';
  if (idx1h.length >= 2) {
    const hh = idx1h.map(i => d1h.highs[i]), ll = idx1h.map(i => d1h.lows[i]);
    const cc = idx1h.map(i => d1h.closes[i]), vv = idx1h.map(i => d1h.volumes[i]);
    const vw = vwapCalc(hh, ll, cc, vv);
    const e3 = ema(cc, 3);
    const len = cc.length;
    const price = cc[len - 1], vwapNow = vw[len - 1], emaNow = e3[len - 1];
    if (price > vwapNow && price > emaNow) bias1h = 'BULLISH';
    else if (price < vwapNow && price < emaNow) bias1h = 'BEARISH';
  }
  if (bias1h === 'NEUTRAL') return trades;

  // 5M candles for the day
  const idx5 = filterDay(d5, dateStr, 570, 960);
  if (idx5.length < 20) return trades;
  const h = idx5.map(i => d5.highs[i]), l = idx5.map(i => d5.lows[i]);
  const c = idx5.map(i => d5.closes[i]), o = idx5.map(i => d5.opens[i]);
  const v = idx5.map(i => d5.volumes[i]);
  const vw = vwapCalc(h, l, c, v);
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const len = c.length;

  // 15M-equiv confirmation
  const confIdx = Math.min(12, len - 1);
  const trendAligned = bias1h === 'BULLISH' ? (e9[confIdx] > e21[confIdx] && c[confIdx] > vw[confIdx])
    : (e9[confIdx] < e21[confIdx] && c[confIdx] < vw[confIdx]);

  const levels15 = swingLevels(h, l, 0, Math.min(confIdx + 5, len));

  let inTrade = false;

  for (let j = Math.max(8, confIdx + 1); j < len - 3; j++) {
    if (inTrade) continue;

    const candleMin = getMinET(d5.timestamps[idx5[j]]);
    if (!((candleMin >= 575 && candleMin <= 660) || (candleMin >= 840 && candleMin <= 930))) continue;
    const kz = candleMin <= 660 ? 'MORNING' : 'POWER_HOUR';

    const price = c[j];
    if (!price) continue;

    const vwapNow = vw[j];
    const vwapOk = bias1h === 'BULLISH' ? price > vwapNow : price < vwapNow;
    if (!vwapOk) continue;

    // ═══ REJECTION ZONES — detect from last 40 candles ═══
    const zones = detectRejectionZones(h, l, o, c, Math.max(0, j - 40), j);
    const confirmedZones = zones.filter(z => z.confirmed);

    // Swing levels
    const levels5 = swingLevels(h, l, Math.max(0, j - 20), j);
    const allLevels = [...levels5, ...levels15];

    // Sweep detection
    let sweep = null;
    for (let k = Math.max(j - 3, 0); k <= j; k++) {
      if (!c[k] || !o[k] || !h[k] || !l[k]) continue;
      const body = Math.abs(c[k] - o[k]);
      const wickDn = Math.min(c[k], o[k]) - l[k];
      const wickUp = h[k] - Math.max(c[k], o[k]);
      for (const lv of allLevels) {
        if (lv.type === 'LOW' && l[k] < lv.price && c[k] > lv.price && wickDn > body * 0.5)
          sweep = { type: 'BULL', candleIdx: k };
        if (lv.type === 'HIGH' && h[k] > lv.price && c[k] < lv.price && wickUp > body * 0.5)
          sweep = { type: 'BEAR', candleIdx: k };
      }
    }
    if (sweep && bias1h === 'BULLISH' && sweep.type !== 'BULL') continue;
    if (sweep && bias1h === 'BEARISH' && sweep.type !== 'BEAR') continue;

    // MSS
    let mss = false;
    if (sweep) {
      const si = sweep.candleIdx;
      if (sweep.type === 'BULL') {
        let rh = -Infinity;
        for (let k = Math.max(0, si - 10); k < si; k++) { if (h[k] > rh) rh = h[k]; }
        for (let k = si + 1; k <= Math.min(j, si + 12); k++) { if (h[k] > rh) { mss = true; break; } }
      } else {
        let rl = Infinity;
        for (let k = Math.max(0, si - 10); k < si; k++) { if (l[k] < rl) rl = l[k]; }
        for (let k = si + 1; k <= Math.min(j, si + 12); k++) { if (l[k] < rl) { mss = true; break; } }
      }
    }

    // FVG
    let fvg = false;
    for (let k = Math.max(2, j - 4); k <= j; k++) {
      if (!h[k] || !l[k] || !h[k - 2] || !l[k - 2]) continue;
      if (l[k] > h[k - 2] && (l[k] - h[k - 2]) > 0.03) fvg = true;
      if (h[k] < l[k - 2] && (l[k - 2] - h[k]) > 0.03) fvg = true;
    }

    // Displacement
    let displacement = false;
    const avgBody = c.slice(Math.max(0, j - 10), j).reduce((s, c2, i2) => s + Math.abs((c2 || 0) - (o[Math.max(0, j - 10) + i2] || 0)), 0) / 10;
    for (let k = Math.max(1, j - 2); k <= j; k++) {
      if (!o[k] || !c[k]) continue;
      if (Math.abs(c[k] - o[k]) > avgBody * 1.5) displacement = true;
    }

    // VWAP reclaim
    let vwapReclaim = false;
    if (j >= 4 && vw[j - 3] && vw[j]) {
      if (c[j - 3] < vw[j - 3] && c[j - 2] < vw[j - 2] && c[j] > vw[j] && bias1h === 'BULLISH') vwapReclaim = true;
      if (c[j - 3] > vw[j - 3] && c[j - 2] > vw[j - 2] && c[j] < vw[j] && bias1h === 'BEARISH') vwapReclaim = true;
    }

    // Setup type
    let setupType = 'NONE';
    if (sweep && mss && (fvg || displacement)) setupType = 'SWEEP_MSS_FVG';
    else if (sweep && mss) setupType = 'SWEEP_MSS';
    else if (vwapReclaim && displacement) setupType = 'VWAP_RECLAIM';
    else if (sweep && displacement) setupType = 'SWEEP_DISP';
    if (setupType === 'NONE') continue;

    // SPY/VIX convergence
    const targetTs = d5.timestamps[idx5[j]];
    let spyOk = false, vixOk = false;
    if (spyD) {
      let si = -1;
      for (let i = spyD.timestamps.length - 1; i >= 0; i--) { if (spyD.timestamps[i] <= targetTs) { si = i; break; } }
      if (si >= 3 && spyD.closes[si] != null && spyD.closes[si - 3] != null) {
        const chg = spyD.closes[si] - spyD.closes[si - 3];
        spyOk = bias1h === 'BULLISH' ? chg > 0 : chg < 0;
      }
    }
    if (vixD) {
      let vi = -1;
      for (let i = vixD.timestamps.length - 1; i >= 0; i--) { if (vixD.timestamps[i] <= targetTs) { vi = i; break; } }
      if (vi >= 3 && vixD.closes[vi] != null && vixD.closes[vi - 3] != null) {
        const chg = vixD.closes[vi] - vixD.closes[vi - 3];
        vixOk = bias1h === 'BULLISH' ? chg < 0 : chg > 0;
      }
    }

    // RVOL
    const avgVol = v.slice(Math.max(0, j - 20), j).filter(x => x > 0).reduce((a, b) => a + b, 0) / 20;
    const rvol = avgVol ? +((v[j] || 0) / avgVol).toFixed(2) : 0;

    // SCORING (same as v3)
    let score = 0;
    score += 1; // bias1h
    if (trendAligned) score += 1;
    if (sweep) score += 2;
    if (mss) score += 2;
    if (vwapOk) score += 1;
    if (fvg) score += 1;
    if (displacement) score += 1;
    if (vwapReclaim) score += 1;
    if (spyOk) score += 1;
    if (vixOk) score += 1;
    if (rvol >= 1.5) score += 1;

    // ═══ REJECTION ZONE SCORING BONUS ═══
    const dir = bias1h === 'BULLISH' ? 'CALL' : 'PUT';
    let rejectionBonus = 0;
    let rejectionUsed = null;

    // CALL: price near a confirmed demand zone = bullish (bouncing off support)
    // PUT: price near a confirmed supply zone = bearish (rejecting resistance)
    const nearType = dir === 'CALL' ? 'DEMAND' : 'SUPPLY';
    const near = nearZone(price, confirmedZones, nearType, 0.50);
    if (near) {
      rejectionBonus = near.strength === 'STRONG' ? 2 : 1;
      rejectionUsed = near;
    }

    score += rejectionBonus;

    if (score < 5) continue;

    // ═══ SL PROTECTION — don't put SL inside a confirmed zone ═══
    let sl = dir === 'CALL' ? +(price - FIXED_SL).toFixed(2) : +(price + FIXED_SL).toFixed(2);
    const slZone = slInZone(sl, confirmedZones, dir);
    let slAdjusted = false;
    if (slZone) {
      // Move SL just beyond the zone (give it room to bounce)
      if (dir === 'CALL') {
        sl = +(slZone.price - 0.15).toFixed(2); // SL below demand zone
      } else {
        sl = +(slZone.price + 0.15).toFixed(2); // SL above supply zone
      }
      slAdjusted = true;
    }

    const slDist = Math.abs(price - sl);
    // Don't take trade if SL adjustment made it too wide (> $2.00)
    if (slDist > 2.00) continue;

    const entry = +price.toFixed(2);

    // Test TP 1:2 and 1:3 based on actual SL distance
    for (const tpM of [2, 3]) {
      const tp = dir === 'CALL' ? +(entry + slDist * tpM).toFixed(2) : +(entry - slDist * tpM).toFixed(2);
      let exitPrice = null, resultado = 'CIERRE';
      for (let f = j + 1; f < len; f++) {
        if (dir === 'CALL') {
          if (l[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (h[f] >= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
        } else {
          if (h[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (l[f] <= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
        }
      }
      if (!exitPrice) { exitPrice = c[len - 1] || entry; }
      const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
      const hora = new Date(d5.timestamps[idx5[j]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      trades.push({
        fecha: dateStr, hora, ticker, dir, entry, sl, tp, tpMult: tpM,
        exit: +exitPrice.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
        resultado, score, kz, setupType, bias1h,
        slDist: +slDist.toFixed(2), slAdjusted,
        rejectionZone: rejectionUsed ? `${rejectionUsed.type} $${rejectionUsed.price} (${rejectionUsed.strength}, ${rejectionUsed.count}x)` : 'NONE',
        confirmedZones: confirmedZones.length,
      });
    }
    inTrade = true;
  }
  return trades;
}

function summarize(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalC = trades.reduce((s, t) => s + t.pnlC, 0);
  const wr = trades.length ? (wins.length / trades.length * 100).toFixed(0) : 0;
  const avgW = wins.length ? (wins.reduce((s, t) => s + t.pnlC, 0) / wins.length).toFixed(0) : 0;
  const avgL = losses.length ? (losses.reduce((s, t) => s + t.pnlC, 0) / losses.length).toFixed(0) : 0;
  const pf = losses.length && losses.reduce((s, t) => s + t.pnlC, 0) !== 0 ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';
  return { total: trades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BACKTEST ICT v3 + REJECTION ZONES — 60 DIAS');
  console.log('  1H=Bias | 5M=Setup+Entry | Rejection Zone SL protection');
  console.log('  + Zone confluence bonus scoring');
  console.log('  Tickers: ' + TICKERS.join(', '));
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('Fetching data...\n');
  const data5m = {}, data1h = {};
  for (const t of TICKERS) {
    process.stdout.write(`  ${t}...`);
    data5m[t] = await fetchYahoo(t, '5m', '60d');
    data1h[t] = await fetchYahoo(t, '1h', '60d');
    console.log(data5m[t] ? ' ✅' : ' ⚠️');
  }
  const spyD = data5m['SPY'] || await fetchYahoo('SPY', '5m', '60d');
  const vixD = await fetchYahoo('^VIX', '5m', '60d');

  const allTs = [];
  for (const t of TICKERS) { if (data5m[t]) allTs.push(...data5m[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`\nDias: ${dates.length} | ${dates[0]} → ${dates[dates.length - 1]}\n`);

  const allTrades = [];
  for (const d of dates) {
    for (const ticker of TICKERS) {
      const dt = await backtestDay(d, data5m, data1h, spyD, vixD, ticker);
      allTrades.push(...dt);
    }
  }

  if (allTrades.length === 0) { console.log('❌ No trades.\n'); return; }

  // Compare TP ratios
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION POR R:R');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`${'Config'.padEnd(35)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(5)} ${'L'.padEnd(5)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} Cuenta`);
  console.log('─'.repeat(100));

  let bestPnl = -Infinity, bestTpM = 3;
  for (const tpM of [2, 3]) {
    const group = allTrades.filter(t => t.tpMult === tpM);
    const s = summarize(group);
    const pnlStr = (s.totalC >= 0 ? '+$' : '-$') + Math.abs(s.totalC);
    if (s.totalC > bestPnl) { bestPnl = s.totalC; bestTpM = tpM; }
    console.log(`SL adaptive | TP 1:${tpM}`.padEnd(35) + ` ${String(s.total).padEnd(8)} ${(s.wr + '%').padEnd(6)} ${String(s.wins).padEnd(5)} ${String(s.losses).padEnd(5)} ${pnlStr.padEnd(10)} +$${s.avgW.toString().padEnd(6)} $${s.avgL.toString().padEnd(7)} ${s.pf.padEnd(6)} $${(2000 + s.totalC).toLocaleString()}`);
  }

  const best = allTrades.filter(t => t.tpMult === bestTpM);
  const bs = summarize(best);

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  MEJOR: TP 1:${bestTpM} | ${bs.wins}W ${bs.losses}L | ${bs.wr}% WR | PF ${bs.pf}`);
  console.log(`  PnL: ${bs.totalC >= 0 ? '+' : ''}$${bs.totalC} | $2,000 → $${(2000 + bs.totalC).toLocaleString()}`);
  console.log(`═══════════════════════════════════════════════════════════════════`);

  // Compare WITH vs WITHOUT rejection zones
  const withRej = best.filter(t => t.rejectionZone !== 'NONE');
  const withoutRej = best.filter(t => t.rejectionZone === 'NONE');
  const slAdj = best.filter(t => t.slAdjusted);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  IMPACTO DE REJECTION ZONES');
  console.log('═══════════════════════════════════════════════════════════════════');
  const sWithRej = summarize(withRej);
  const sWithoutRej = summarize(withoutRej);
  const sSlAdj = summarize(slAdj);
  console.log(`  Con Rejection Zone:   ${sWithRej.total} trades | ${sWithRej.wr}% WR | ${sWithRej.totalC >= 0 ? '+' : ''}$${sWithRej.totalC} | PF ${sWithRej.pf}`);
  console.log(`  Sin Rejection Zone:   ${sWithoutRej.total} trades | ${sWithoutRej.wr}% WR | ${sWithoutRej.totalC >= 0 ? '+' : ''}$${sWithoutRej.totalC} | PF ${sWithoutRej.pf}`);
  console.log(`  SL Ajustado por zona: ${sSlAdj.total} trades | ${sSlAdj.wr}% WR | ${sSlAdj.totalC >= 0 ? '+' : ''}$${sSlAdj.totalC} | PF ${sSlAdj.pf}`);

  // Compare vs original v3
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  v3 ORIGINAL vs v3 + REJECTION ZONES');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  v3 Original:          251 trades | 62% WR | +$7,461 | PF 2.65`);
  console.log(`  v3 + Rejection Zones: ${bs.total} trades | ${bs.wr}% WR | ${bs.totalC >= 0 ? '+' : ''}$${bs.totalC} | PF ${bs.pf}`);
  const diff = bs.totalC - 7461;
  console.log(`  Diferencia:           ${diff >= 0 ? '+' : ''}$${diff} (${diff >= 0 ? 'MEJORA' : 'PEOR'})`);

  // Per ticker
  console.log('\n── Por Ticker ──');
  for (const tk of TICKERS) {
    const dt = best.filter(t => t.ticker === tk);
    if (dt.length === 0) continue;
    const s = summarize(dt);
    const rejCount = dt.filter(t => t.rejectionZone !== 'NONE').length;
    console.log(`  ${tk.padEnd(5)}: ${s.total} trades | ${s.wr}% WR | ${s.totalC >= 0 ? '+' : ''}$${s.totalC} | PF ${s.pf} | ${rejCount} con zona`);
  }

  // Per week
  console.log('\n── Por Semana ──');
  const weeks = {};
  for (const t of best) {
    const d = new Date(t.fecha); const ws = new Date(d); ws.setDate(d.getDate() - d.getDay() + 1);
    const wk = ws.toISOString().slice(0, 10);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(t);
  }
  let cum = 0;
  for (const [wk, wt] of Object.entries(weeks).sort()) {
    const ws = summarize(wt);
    cum += ws.totalC;
    console.log(`  ${wk}: ${ws.total} trades | ${ws.wr}% WR | ${ws.totalC >= 0 ? '+' : ''}$${ws.totalC} | Acum: ${cum >= 0 ? '+' : ''}$${cum}`);
  }

  // Dias
  let posDays = 0, negDays = 0;
  for (const d of dates) {
    const dt = best.filter(t => t.fecha === d);
    if (dt.length === 0) continue;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    if (dp >= 0) posDays++; else negDays++;
  }
  console.log(`\n  Dias positivos: ${posDays} | Negativos: ${negDays} | Win days: ${(posDays / (posDays + negDays) * 100).toFixed(0)}%`);

  let peak = 0, maxDD = 0, run = 0;
  for (const t of best) { run += t.pnlC; if (run > peak) peak = run; if (peak - run > maxDD) maxDD = peak - run; }
  console.log(`  Max Drawdown: $${maxDD}\n`);
}

main().catch(e => console.error('Error:', e.message));
