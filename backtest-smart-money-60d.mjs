// Backtest ICT Smart Money v3 — 60 days using 5min data
// 1H=Bias | 15M≈5M structure | 5M=Setup+Entry
// Since Yahoo limits 1min to 7d, we use 5min for 60d range
const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50;
const FIXED_SL = 1.00;

async function fetchYahoo(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) return null;
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

async function backtestDay(dateStr, data5m, data1h, spyD, vixD, ticker) {
  const trades = [];
  const d5 = data5m[ticker];
  const d1h = data1h[ticker];
  if (!d5) return trades;

  // ── STEP 1: 1H Bias ──
  const idx1h = d1h ? filterDay(d1h, dateStr, 570, 960) : [];
  let bias1h = 'NEUTRAL', biasStructure = 'MIXED';
  if (idx1h.length >= 2) {
    const hh = idx1h.map(i => d1h.highs[i]), ll = idx1h.map(i => d1h.lows[i]);
    const cc = idx1h.map(i => d1h.closes[i]), vv = idx1h.map(i => d1h.volumes[i]);
    const vw = vwapCalc(hh, ll, cc, vv);
    const e3 = ema(cc, 3);
    const len = cc.length;
    const price = cc[len - 1], vwapNow = vw[len - 1], emaNow = e3[len - 1];
    if (price > vwapNow && price > emaNow) bias1h = 'BULLISH';
    else if (price < vwapNow && price < emaNow) bias1h = 'BEARISH';
    if (len >= 3) {
      if (hh[len - 1] > hh[len - 2] && ll[len - 1] > ll[len - 2]) biasStructure = 'HH+HL';
      else if (ll[len - 1] < ll[len - 2] && hh[len - 1] < hh[len - 2]) biasStructure = 'LL+LH';
    }
  }
  if (bias1h === 'NEUTRAL') return trades;

  // ── STEP 2: 15M-equivalent confirmation using first hour of 5M ──
  // Use first 12 candles of 5min (= 1 hour) to establish trend
  const idx5 = filterDay(d5, dateStr, 570, 960);
  if (idx5.length < 20) return trades;
  const h = idx5.map(i => d5.highs[i]), l = idx5.map(i => d5.lows[i]);
  const c = idx5.map(i => d5.closes[i]), o = idx5.map(i => d5.opens[i]);
  const v = idx5.map(i => d5.volumes[i]);
  const vw = vwapCalc(h, l, c, v);
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const len = c.length;

  // Check 15M-equivalent confirmation at candle 12 (1 hour in)
  const confIdx = Math.min(12, len - 1);
  const trendAligned = bias1h === 'BULLISH' ? (e9[confIdx] > e21[confIdx] && c[confIdx] > vw[confIdx])
    : (e9[confIdx] < e21[confIdx] && c[confIdx] < vw[confIdx]);

  // 15M-equivalent swing levels (from first half of day)
  const levels15 = swingLevels(h, l, 0, Math.min(confIdx + 5, len));

  // ── STEP 3: 5M Setup — walk candles ──
  let inTrade = false;

  for (let j = Math.max(8, confIdx + 1); j < len - 3; j++) {
    if (inTrade) continue;

    const candleMin = getMinET(d5.timestamps[idx5[j]]);
    // Morning KZ (9:35-11:00) or Power Hour (14:00-15:30)
    if (!((candleMin >= 575 && candleMin <= 660) || (candleMin >= 840 && candleMin <= 930))) continue;
    const kz = candleMin <= 660 ? 'MORNING' : 'POWER_HOUR';

    const price = c[j];
    if (!price) continue;

    // VWAP alignment
    const vwapNow = vw[j];
    const vwapOk = bias1h === 'BULLISH' ? price > vwapNow : price < vwapNow;
    if (!vwapOk) continue;

    // Swing levels from 5M + 15M-equiv
    const levels5 = swingLevels(h, l, Math.max(0, j - 20), j);
    const allLevels = [...levels5, ...levels15];

    // Sweep detection (last 3 candles)
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
    // Bias filter
    if (sweep && bias1h === 'BULLISH' && sweep.type !== 'BULL') continue;
    if (sweep && bias1h === 'BEARISH' && sweep.type !== 'BEAR') continue;

    // MSS detection (12 candle lookback)
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

    // SCORING
    let score = 0;
    score += 1; // bias1h confirmed
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

    if (score < 5) continue;

    // ENTRY
    const dir = bias1h === 'BULLISH' ? 'CALL' : 'PUT';
    const entry = +price.toFixed(2);
    const sl = dir === 'CALL' ? +(entry - FIXED_SL).toFixed(2) : +(entry + FIXED_SL).toFixed(2);

    // Test TP 1:2 and 1:3
    for (const tpM of [2, 3]) {
      const tp = dir === 'CALL' ? +(entry + FIXED_SL * tpM).toFixed(2) : +(entry - FIXED_SL * tpM).toFixed(2);
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
        resultado, score, kz, setupType, bias1h, conf: trendAligned,
        spyOk, vixOk, rvol,
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
  console.log('  BACKTEST ICT SMART MONEY v3 — 60 DIAS (5min data)');
  console.log('  1H=Bias | 5M=Confirm+Setup+Entry');
  console.log('  Morning KZ + Power Hour | Score >= 5 | SL $1.00');
  console.log('  Tickers: ' + TICKERS.join(', '));
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('Fetching data (5min 60d + 1h 60d for 8 tickers)...\n');

  const data5m = {}, data1h = {};
  for (const t of TICKERS) {
    process.stdout.write(`  ${t}...`);
    data5m[t] = await fetchYahoo(t, '5m', '60d');
    data1h[t] = await fetchYahoo(t, '1h', '60d');
    console.log(data5m[t] ? ` ✅ (${data5m[t].timestamps.length} candles)` : ' ⚠️');
  }

  const spyD = data5m['SPY'] || await fetchYahoo('SPY', '5m', '60d');
  const vixD = await fetchYahoo('^VIX', '5m', '60d');

  // Get unique trading dates
  const allTs = [];
  for (const t of TICKERS) { if (data5m[t]) allTs.push(...data5m[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`\nDias de trading: ${dates.length}`);
  console.log(`Rango: ${dates[0]} → ${dates[dates.length - 1]}\n`);

  // Run backtest
  const allTrades = [];
  for (const d of dates) {
    for (const ticker of TICKERS) {
      const dt = await backtestDay(d, data5m, data1h, spyD, vixD, ticker);
      allTrades.push(...dt);
    }
  }

  if (allTrades.length === 0) {
    console.log('❌ No trades encontrados.\n');
    return;
  }

  // Compare TP ratios
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION POR R:R');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`${'Config'.padEnd(28)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(5)} ${'L'.padEnd(5)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} Cuenta`);
  console.log('─'.repeat(95));

  let bestPnl = -Infinity, bestTpM = 3;
  for (const tpM of [2, 3]) {
    const group = allTrades.filter(t => t.tpMult === tpM);
    const s = summarize(group);
    const pnlStr = (s.totalC >= 0 ? '+$' : '-$') + Math.abs(s.totalC);
    if (s.totalC > bestPnl) { bestPnl = s.totalC; bestTpM = tpM; }
    const star = s.totalC >= bestPnl ? ' ⭐' : '';
    console.log(`SL $1.00 | TP 1:${tpM} ($${(1 * tpM).toFixed(2)})`.padEnd(28) + ` ${String(s.total).padEnd(8)} ${(s.wr + '%').padEnd(6)} ${String(s.wins).padEnd(5)} ${String(s.losses).padEnd(5)} ${pnlStr.padEnd(10)} +$${s.avgW.toString().padEnd(6)} $${s.avgL.toString().padEnd(7)} ${s.pf.padEnd(6)} $${(2000 + s.totalC).toLocaleString()}${star}`);
  }

  const best = allTrades.filter(t => t.tpMult === bestTpM);
  const bs = summarize(best);

  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  MEJOR: SL $1.00 | TP 1:${bestTpM} | ${bs.wins}W ${bs.losses}L | ${bs.wr}% WR | PF ${bs.pf}`);
  console.log(`  PnL: ${bs.totalC >= 0 ? '+' : ''}$${bs.totalC} | Cuenta: $2,000 → $${(2000 + bs.totalC).toLocaleString()}`);
  console.log(`═══════════════════════════════════════════════════════════════════`);

  // Per week summary
  console.log('\n── Por Semana ──');
  const weeks = {};
  for (const t of best) {
    const d = new Date(t.fecha);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay() + 1);
    const wk = weekStart.toISOString().slice(0, 10);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(t);
  }
  let cumPnl = 0;
  for (const [wk, wt] of Object.entries(weeks).sort()) {
    const ws = summarize(wt);
    cumPnl += ws.totalC;
    const tickers = [...new Set(wt.map(t => t.ticker))].join(',');
    console.log(`  ${wk}: ${ws.total} trades | ${ws.wr}% WR | ${ws.totalC >= 0 ? '+' : ''}$${ws.totalC} | Acum: ${cumPnl >= 0 ? '+' : ''}$${cumPnl} | ${tickers}`);
  }

  // Per ticker
  console.log('\n── Por Ticker ──');
  console.log(`${'Ticker'.padEnd(7)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(4)} ${'L'.padEnd(4)} ${'PnL'.padEnd(10)} ${'PF'.padEnd(6)}`);
  console.log('─'.repeat(50));
  for (const tk of TICKERS) {
    const dt = best.filter(t => t.ticker === tk);
    if (dt.length === 0) { console.log(`  ${tk.padEnd(5)}: Sin trades`); continue; }
    const s = summarize(dt);
    const pnlStr = (s.totalC >= 0 ? '+$' : '-$') + Math.abs(s.totalC);
    console.log(`${tk.padEnd(7)} ${String(s.total).padEnd(8)} ${(s.wr + '%').padEnd(6)} ${String(s.wins).padEnd(4)} ${String(s.losses).padEnd(4)} ${pnlStr.padEnd(10)} ${s.pf}`);
  }

  // Setup types
  console.log('\n── Setup Types ──');
  const stypes = {};
  for (const t of best) { if (!stypes[t.setupType]) stypes[t.setupType] = []; stypes[t.setupType].push(t); }
  for (const [k, st] of Object.entries(stypes)) {
    const s = summarize(st);
    console.log(`  ${k.padEnd(20)} ${s.total} trades | ${s.wr}% WR | ${s.totalC >= 0 ? '+' : ''}$${s.totalC} | PF ${s.pf}`);
  }

  // ALL trades detail
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  TODAS LAS ENTRADAS');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`${'#'.padEnd(4)} ${'Fecha'.padEnd(12)} ${'Hora'.padEnd(8)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(10)} ${'SL'.padEnd(10)} ${'TP'.padEnd(10)} ${'Exit'.padEnd(10)} ${'$Cont'.padEnd(8)} ${'Sc'.padEnd(4)} ${'KZ'.padEnd(8)} ${'Bias'.padEnd(5)} Setup`);
  console.log('─'.repeat(115));
  let runTotal = 0;
  best.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
  best.forEach((t, i) => {
    runTotal += t.pnlC;
    const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
    const res = t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪';
    const biasShort = t.bias1h === 'BULLISH' ? 'BULL' : 'BEAR';
    console.log(`${String(i+1).padEnd(4)} ${t.fecha.padEnd(12)} ${t.hora.padEnd(8)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${t.entry.toString().padEnd(9)} $${t.sl.toString().padEnd(9)} $${t.tp.toString().padEnd(9)} $${t.exit.toString().padEnd(9)} ${pnlCStr.padEnd(8)} ${String(t.score).padEnd(4)} ${t.kz.slice(0,7).padEnd(8)} ${biasShort.padEnd(5)} ${res} ${t.setupType}`);
  });
  console.log('─'.repeat(115));
  console.log(`Total: ${best.length} trades | ${bs.totalC >= 0 ? '+' : ''}$${bs.totalC}\n`);

  // Daily detail (abbreviated — show only days with trades)
  console.log('\n── Detalle por Dia (dias con trades) ──');
  let positiveDays = 0, negativeDays = 0;
  for (const d of dates) {
    const dt = best.filter(t => t.fecha === d);
    if (dt.length === 0) continue;
    const dw = dt.filter(t => t.pnl > 0).length;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    if (dp >= 0) positiveDays++; else negativeDays++;
    const tickers = dt.map(t => `${t.ticker}(${t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪'})`).join(' ');
    console.log(`  ${d}: ${dt.length} trades | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp} | ${tickers}`);
  }

  console.log(`\n  Dias positivos: ${positiveDays} | Dias negativos: ${negativeDays} | Win days: ${(positiveDays / (positiveDays + negativeDays) * 100).toFixed(0)}%`);

  // Max drawdown
  let peak = 0, maxDD = 0, running = 0;
  for (const t of best.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))) {
    running += t.pnlC;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  }
  console.log(`\n  Max Drawdown: $${maxDD}`);
  console.log(`  Recovery: ${peak > 0 ? (maxDD / peak * 100).toFixed(0) + '% of peak' : 'N/A'}`);
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
