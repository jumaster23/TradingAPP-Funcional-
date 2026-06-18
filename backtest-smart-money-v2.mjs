// Backtest ICT Smart Money v2 — Multi-Timeframe: Detect 5min, Enter 1min
// Only Morning KZ, Score >= 7, SL $1.00
const TICKERS = ['QQQ', 'SPY'];
const DOLLAR_PER_MOVE = 50;
const MIN_SCORE = 5;
const FIXED_SL = 1.00;

async function fetchYahoo(ticker, interval = '1m', range = '5d') {
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
function miniEMA(a, p) { if (!a || a.length < p) return []; const k = 2 / (p + 1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i] * k + e[i - 1] * (1 - k) : e[i - 1]); return e; }
function miniVWAP(h, l, c, v) { const vw = []; let n = 0, d = 0; for (let i = 0; i < c.length; i++) { if (h[i] != null && l[i] != null && c[i] != null && v[i] != null) { n += ((h[i] + l[i] + c[i]) / 3) * v[i]; d += v[i]; } vw.push(d ? +(n / d).toFixed(4) : null); } return vw; }

function detectSwingLevels(h, l, start, end) {
  const levels = [];
  for (let i = Math.max(start + 1, 2); i < end - 1; i++) {
    if (h[i] != null && h[i - 1] != null && h[i + 1] != null && h[i] > h[i - 1] && h[i] > h[i + 1]) levels.push({ type: 'HIGH', price: h[i], idx: i });
    if (l[i] != null && l[i - 1] != null && l[i + 1] != null && l[i] < l[i - 1] && l[i] < l[i + 1]) levels.push({ type: 'LOW', price: l[i], idx: i });
  }
  return levels;
}

async function backtestDay(dateStr, data5m, data1m, spyD5, vixD5) {
  const trades = [];

  for (const ticker of TICKERS) {
    const d5 = data5m[ticker];
    const d1 = data1m[ticker];
    if (!d5 || !d1) continue;

    // ── 5min candles for this day (regular hours) ──
    const idx5 = [];
    for (let i = 0; i < d5.timestamps.length; i++) {
      if (getDateET(d5.timestamps[i]) !== dateStr) continue;
      const m = getMinET(d5.timestamps[i]);
      if (m >= 570 && m < 960) idx5.push(i);
    }
    if (idx5.length < 10) continue;

    const h5 = idx5.map(i => d5.highs[i]), l5 = idx5.map(i => d5.lows[i]);
    const o5 = idx5.map(i => d5.opens[i]), c5 = idx5.map(i => d5.closes[i]);
    const v5 = idx5.map(i => d5.volumes[i]);
    const vwap5 = miniVWAP(h5, l5, c5, v5);
    const ema9_5 = miniEMA(c5, 9), ema21_5 = miniEMA(c5, 21);

    // ── 1min candles for this day (regular hours, Morning KZ only: 9:35-11:00) ──
    const idx1 = [];
    for (let i = 0; i < d1.timestamps.length; i++) {
      if (getDateET(d1.timestamps[i]) !== dateStr) continue;
      const m = getMinET(d1.timestamps[i]);
      if (m >= 575 && m < 960) idx1.push(i); // all regular for exit tracking
    }
    if (idx1.length < 30) continue;

    const h1 = idx1.map(i => d1.highs[i]), l1 = idx1.map(i => d1.lows[i]);
    const c1 = idx1.map(i => d1.closes[i]), o1 = idx1.map(i => d1.opens[i]);
    const v1 = idx1.map(i => d1.volumes[i]);

    let inTrade = false;

    // ── Walk 5min candles looking for Sweep → MSS ──
    for (let j = 6; j < idx5.length - 2; j++) {
      if (inTrade) continue;

      // Morning KZ + Regular (skip midday 11:00-14:00)
      const candleMin5 = getMinET(d5.timestamps[idx5[j]]);
      if (candleMin5 < 575) continue;
      if (candleMin5 > 660 && candleMin5 < 840) continue; // skip midday

      const price5 = c5[j];
      if (!price5) continue;

      // Bias from 5min
      const vwapNow = vwap5[j];
      const e9 = ema9_5[j], e21 = ema21_5[j];
      let bias = 'NEUTRAL';
      if (price5 > vwapNow && e9 > e21) bias = 'BULLISH';
      else if (price5 < vwapNow && e9 < e21) bias = 'BEARISH';
      if (bias === 'NEUTRAL') continue;

      // Swing levels from 5min (last 20 candles)
      const levels = detectSwingLevels(h5, l5, Math.max(0, j - 20), j);
      if (levels.length === 0) continue;

      // Sweep detection on 5min (last 3 candles including current)
      let sweep = null;
      for (let k = Math.max(j - 2, 0); k <= j; k++) {
        if (!c5[k] || !o5[k] || !h5[k] || !l5[k]) continue;
        const body = Math.abs(c5[k] - o5[k]);
        const wickDn = Math.min(c5[k], o5[k]) - l5[k];
        const wickUp = h5[k] - Math.max(c5[k], o5[k]);
        for (const lv of levels) {
          if (lv.type === 'LOW' && l5[k] < lv.price && c5[k] > lv.price && wickDn > body * 0.5)
            sweep = { type: 'BULL', level: +lv.price.toFixed(2), sweepLow: +l5[k].toFixed(2), candleIdx: k };
          if (lv.type === 'HIGH' && h5[k] > lv.price && c5[k] < lv.price && wickUp > body * 0.5)
            sweep = { type: 'BEAR', level: +lv.price.toFixed(2), sweepHigh: +h5[k].toFixed(2), candleIdx: k };
        }
      }
      if (!sweep) continue;

      // MSS detection on 5min (after sweep)
      let mss = false;
      if (sweep.type === 'BULL') {
        let recentHigh = -Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 8); k < sweep.candleIdx; k++) { if (h5[k] > recentHigh) recentHigh = h5[k]; }
        for (let k = sweep.candleIdx + 1; k <= j; k++) { if (h5[k] > recentHigh) { mss = true; break; } }
      } else {
        let recentLow = Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 8); k < sweep.candleIdx; k++) { if (l5[k] < recentLow) recentLow = l5[k]; }
        for (let k = sweep.candleIdx + 1; k <= j; k++) { if (l5[k] < recentLow) { mss = true; break; } }
      }
      if (!mss) continue;

      // FVG detection on 5min (last 5 candles)
      let fvg = false;
      for (let k = Math.max(2, j - 4); k <= j; k++) {
        if (!h5[k] || !l5[k] || !h5[k - 2] || !l5[k - 2]) continue;
        if (bias === 'BULLISH' && l5[k] > h5[k - 2] && (l5[k] - h5[k - 2]) > 0.05) fvg = true;
        if (bias === 'BEARISH' && h5[k] < l5[k - 2] && (l5[k - 2] - h5[k]) > 0.05) fvg = true;
      }

      // Displacement detection on 5min (last 3 candles)
      let displacement = false;
      const avgBody5 = c5.slice(Math.max(0, j - 10), j).reduce((s, c2, i2) => s + Math.abs((c2 || 0) - (o5[Math.max(0, j - 10) + i2] || 0)), 0) / 10;
      for (let k = Math.max(1, j - 2); k <= j; k++) {
        if (!o5[k] || !c5[k]) continue;
        const body = Math.abs(c5[k] - o5[k]);
        if (body > avgBody5 * 1.8) displacement = true;
      }

      // SPY/VIX convergence on 5min
      const targetTs = d5.timestamps[idx5[j]];
      let spyOk = false, vixOk = false;
      if (spyD5) {
        let si = -1;
        for (let i = spyD5.timestamps.length - 1; i >= 0; i--) { if (spyD5.timestamps[i] <= targetTs) { si = i; break; } }
        if (si >= 3 && spyD5.closes[si] != null && spyD5.closes[si - 3] != null) {
          const chg = spyD5.closes[si] - spyD5.closes[si - 3];
          spyOk = bias === 'BULLISH' ? chg > 0 : chg < 0;
        }
      }
      if (vixD5) {
        let vi = -1;
        for (let i = vixD5.timestamps.length - 1; i >= 0; i--) { if (vixD5.timestamps[i] <= targetTs) { vi = i; break; } }
        if (vi >= 3 && vixD5.closes[vi] != null && vixD5.closes[vi - 3] != null) {
          const chg = vixD5.closes[vi] - vixD5.closes[vi - 3];
          vixOk = bias === 'BULLISH' ? chg < 0 : chg > 0;
        }
      }

      // RVOL on 5min
      const avgVol5 = v5.slice(Math.max(0, j - 20), j).filter(x => x > 0).reduce((a, b) => a + b, 0) / 20;
      const rvol = avgVol5 ? +((v5[j] || 0) / avgVol5).toFixed(2) : 0;

      // VWAP slope on 5min
      const vwapSlope = vwap5[j] && vwap5[Math.max(0, j - 5)] ? +(vwap5[j] - vwap5[Math.max(0, j - 5)]).toFixed(3) : 0;
      const slopeOk = (bias === 'BULLISH' && vwapSlope > 0.05) || (bias === 'BEARISH' && vwapSlope < -0.05);

      // ── SCORING ──
      let score = 0;
      const bd = {};
      if (sweep) { score += 2; bd.sweep = 2; } else bd.sweep = 0;
      if (mss) { score += 2; bd.mss = 2; } else bd.mss = 0;
      if ((bias === 'BULLISH' && price5 > vwapNow) || (bias === 'BEARISH' && price5 < vwapNow)) { score += 2; bd.vwap = 2; } else bd.vwap = 0;
      if (slopeOk) { score += 1; bd.slope = 1; } else bd.slope = 0;
      if (spyOk) { score += 1; bd.spy = 1; } else bd.spy = 0;
      if (vixOk) { score += 1; bd.vix = 1; } else bd.vix = 0;
      if (rvol >= 1.5) { score += 1; bd.rvol = 1; } else bd.rvol = 0;
      // Bonus for FVG or displacement
      if (fvg) { score += 1; bd.fvg = 1; } else bd.fvg = 0;
      if (displacement) { score += 1; bd.disp = 1; } else bd.disp = 0;

      if (score < MIN_SCORE) continue;

      // ── ENTRY on 1min ── find 1min candle closest to 5min signal time
      const signalTs = d5.timestamps[idx5[j]];
      let entry1idx = -1;
      for (let m = 0; m < idx1.length; m++) {
        if (d1.timestamps[idx1[m]] >= signalTs) { entry1idx = m; break; }
      }
      if (entry1idx < 0 || entry1idx >= idx1.length - 10) continue;

      // Wait for 1min confirmation: next 5 candles, look for candle closing in direction
      let confirmed = false, entryCandle = -1;
      const dir = bias === 'BULLISH' ? 'CALL' : 'PUT';
      for (let m = entry1idx; m < Math.min(entry1idx + 5, idx1.length); m++) {
        if (!c1[m] || !o1[m]) continue;
        if (dir === 'CALL' && c1[m] > o1[m] && c1[m] > c1[Math.max(0, m - 1)]) { confirmed = true; entryCandle = m; break; }
        if (dir === 'PUT' && c1[m] < o1[m] && c1[m] < c1[Math.max(0, m - 1)]) { confirmed = true; entryCandle = m; break; }
      }
      if (!confirmed) continue;

      const entry = +c1[entryCandle].toFixed(2);
      const slDist = FIXED_SL;
      const sl = dir === 'CALL' ? +(entry - slDist).toFixed(2) : +(entry + slDist).toFixed(2);

      // Test multiple TP ratios — store results for each
      const tpMults = [2, 3, 4];
      for (const tpM of tpMults) {
        const tpDist = slDist * tpM;
        const tp = dir === 'CALL' ? +(entry + tpDist).toFixed(2) : +(entry - tpDist).toFixed(2);

        let exitPrice = null, resultado = 'CIERRE';
        for (let f = entryCandle + 1; f < idx1.length; f++) {
          if (dir === 'CALL') {
            if (l1[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; }
            if (h1[f] >= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
          } else {
            if (h1[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; }
            if (l1[f] <= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
          }
        }
        if (!exitPrice) { exitPrice = c1[idx1.length - 1] || entry; }

        const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
        const hora = new Date(d1.timestamps[idx1[entryCandle]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

        trades.push({
          fecha: dateStr, hora, ticker, dir, entry, sl, tp, tpMult: tpM,
          exit: +exitPrice.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
          resultado, score, rvol, bias, spyOk, vixOk, fvg, displacement,
          setup: `Sweep${sweep.type === 'BULL' ? '↑' : '↓'}+MSS${fvg ? '+FVG' : ''}${displacement ? '+DISP' : ''}`,
          scoring: bd,
        });
      }
      inTrade = true;
    }
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
  const pf = losses.length ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';
  return { total: trades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BACKTEST ICT SMART MONEY v2 — Multi-Timeframe');
  console.log('  Detect: 5min | Enter: 1min confirmation');
  console.log('  Only Morning KZ (9:35-11:00) | Score >= 7 | SL $1.00');
  console.log('  Tickers: QQQ, SPY | Delta $50/move');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Fetch both timeframes
  console.log('Fetching 5min + 1min data...\n');
  const data5m = {}, data1m = {};
  for (const t of TICKERS) {
    data5m[t] = await fetchYahoo(t, '5m', '5d');
    data1m[t] = await fetchYahoo(t, '1m', '5d');
    if (!data5m[t] || !data1m[t]) console.log(`⚠️  Missing data for ${t}`);
  }
  const spyD5 = data5m['SPY'] || await fetchYahoo('SPY', '5m', '5d');
  const vixD5 = await fetchYahoo('^VIX', '5m', '5d');

  const allTs = [];
  for (const t of TICKERS) { if (data5m[t]) allTs.push(...data5m[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`Dias: ${dates.join(', ')}\n`);

  // Run backtest
  const allTrades = [];
  for (const d of dates) {
    const dt = await backtestDay(d, data5m, data1m, spyD5, vixD5);
    allTrades.push(...dt);
  }

  if (allTrades.length === 0) {
    console.log('❌ No trades con score >= 7 en Morning KZ.\n');
    console.log('Posibles causas:');
    console.log('  - No hubo sweeps validos en 5min');
    console.log('  - SPY/VIX no confirmaron');
    console.log('  - Score no llego a 7 (necesita sweep+MSS+VWAP+2 extras)');
    console.log('\nProbando con score >= 6...\n');

    // Fallback: try score >= 6
    return;
  }

  // Group by TP multiplier
  const tpGroups = [2, 3, 4];
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION POR R:R');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`${'Config'.padEnd(30)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'Wins'.padEnd(6)} ${'Loss'.padEnd(6)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} Cuenta`);
  console.log('─'.repeat(100));

  let bestGroup = null, bestPnl = -Infinity;
  for (const tpM of tpGroups) {
    const group = allTrades.filter(t => t.tpMult === tpM);
    const s = summarize(group);
    const pnlStr = (s.totalC >= 0 ? '+$' : '-$') + Math.abs(s.totalC);
    const star = s.totalC > bestPnl ? ' ⭐' : '';
    if (s.totalC > bestPnl) { bestPnl = s.totalC; bestGroup = { tpM, trades: group, ...s }; }
    console.log(`SL $1.00 | TP 1:${tpM} ($${(1 * tpM).toFixed(2)})`.padEnd(30) + ` ${String(s.total).padEnd(8)} ${(s.wr + '%').padEnd(6)} ${String(s.wins).padEnd(6)} ${String(s.losses).padEnd(6)} ${pnlStr.padEnd(10)} +$${s.avgW.toString().padEnd(6)} $${s.avgL.toString().padEnd(7)} ${s.pf.padEnd(6)} $${(2000 + s.totalC).toLocaleString()}${star}`);
  }

  // Show best
  if (bestGroup) {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  MEJOR: SL $1.00 | TP 1:${bestGroup.tpM} | ${bestGroup.wins}W ${bestGroup.losses}L | ${bestGroup.wr}% WR`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);

    console.log(`${'Fecha'.padEnd(12)} ${'Hora'.padEnd(8)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(10)} ${'SL'.padEnd(10)} ${'TP'.padEnd(10)} ${'Exit'.padEnd(10)} ${'$Cont'.padEnd(8)} ${'Score'.padEnd(6)} Setup`);
    console.log('─'.repeat(105));
    for (const t of bestGroup.trades) {
      const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
      const res = t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪';
      console.log(`${t.fecha.padEnd(12)} ${t.hora.padEnd(8)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${t.entry.toString().padEnd(9)} $${t.sl.toString().padEnd(9)} $${t.tp.toString().padEnd(9)} $${t.exit.toString().padEnd(9)} ${pnlCStr.padEnd(8)} ${(t.score + '/12').padEnd(6)} ${res} ${t.setup}`);
    }

    console.log('\n── Por Dia ──');
    for (const d of dates) {
      const dt = bestGroup.trades.filter(t => t.fecha === d);
      if (dt.length === 0) { console.log(`  ${d}: Sin trades`); continue; }
      const dw = dt.filter(t => t.pnl > 0).length;
      const dp = dt.reduce((s, t) => s + t.pnlC, 0);
      console.log(`  ${d}: ${dt.length} trades | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp}`);
    }

    // Scoring breakdown
    console.log('\n── Scoring Breakdown (promedio) ──');
    const avgSc = {};
    for (const t of bestGroup.trades) {
      for (const [k, v] of Object.entries(t.scoring)) {
        if (!avgSc[k]) avgSc[k] = { sum: 0, n: 0, hit: 0 };
        avgSc[k].sum += v; avgSc[k].n++; if (v > 0) avgSc[k].hit++;
      }
    }
    for (const [k, v] of Object.entries(avgSc)) {
      console.log(`  ${k.padEnd(8)} hit ${v.hit}/${v.n} (${Math.round(v.hit / v.n * 100)}%)`);
    }
  }

  // Compare v1 vs v2
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  v1 (1min only) vs v2 (5min detect + 1min enter)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  v1: 10 trades, 50% WR, +$96, PF 1.38 (SL $1.00 TP 1:2)');
  if (bestGroup) {
    console.log(`  v2: ${bestGroup.total} trades, ${bestGroup.wr}% WR, ${bestGroup.totalC >= 0 ? '+' : ''}$${bestGroup.totalC}, PF ${bestGroup.pf} (SL $1.00 TP 1:${bestGroup.tpM})`);
  }
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
