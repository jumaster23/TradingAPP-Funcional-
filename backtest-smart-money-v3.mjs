// Backtest ICT Smart Money v3 — 4-Timeframe Structure
// 1H = Bias | 15M = Confirmation | 5M = Setup | 1M = Entry
// 8 tickers | SL $1.00 | Morning + Power Hour
const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'META', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50;
const FIXED_SL = 1.00;

async function fetchYahoo(ticker, interval, range = '7d') {
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

function filterDay(data, dateStr, minFrom, minTo) {
  const idx = [];
  for (let i = 0; i < data.timestamps.length; i++) {
    if (getDateET(data.timestamps[i]) !== dateStr) continue;
    const m = getMinET(data.timestamps[i]);
    if (m >= minFrom && m < minTo) idx.push(i);
  }
  return idx;
}

function swingLevels(h, l, start, end) {
  const levels = [];
  for (let i = Math.max(start + 1, 2); i < end - 1; i++) {
    if (h[i] != null && h[i - 1] != null && h[i + 1] != null && h[i] > h[i - 1] && h[i] > h[i + 1]) levels.push({ type: 'HIGH', price: h[i], idx: i });
    if (l[i] != null && l[i - 1] != null && l[i + 1] != null && l[i] < l[i - 1] && l[i] < l[i + 1]) levels.push({ type: 'LOW', price: l[i], idx: i });
  }
  return levels;
}

// ═══════════════════════════════════════════════════
// STEP 1: 1H BIAS — direction for the day
// ═══════════════════════════════════════════════════
function get1HBias(data1h, dateStr) {
  const idx = filterDay(data1h, dateStr, 570, 960);
  if (idx.length < 2) return null;
  const h = idx.map(i => data1h.highs[i]), l = idx.map(i => data1h.lows[i]);
  const c = idx.map(i => data1h.closes[i]), v = idx.map(i => data1h.volumes[i]);
  const vw = vwapCalc(h, l, c, v);
  const e9 = ema(c, 3); // 3-period EMA on 1H ≈ 3 hours
  const len = c.length;
  const price = c[len - 1], vwapNow = vw[len - 1], emaNow = e9[len - 1];

  // Also check previous day's close for context
  const allIdx = [];
  for (let i = 0; i < data1h.timestamps.length; i++) {
    const m = getMinET(data1h.timestamps[i]);
    if (m >= 570 && m < 960) allIdx.push(i);
  }
  // Higher high / higher low structure on 1H
  let hh = false, hl = false, ll = false, lh = false;
  if (len >= 3) {
    hh = h[len - 1] > h[len - 2];
    hl = l[len - 1] > l[len - 2];
    ll = l[len - 1] < l[len - 2];
    lh = h[len - 1] < h[len - 2];
  }

  let bias = 'NEUTRAL';
  if (price > vwapNow && price > emaNow && (hh || hl)) bias = 'BULLISH';
  else if (price < vwapNow && price < emaNow && (ll || lh)) bias = 'BEARISH';
  else if (price > vwapNow && price > emaNow) bias = 'BULLISH';
  else if (price < vwapNow && price < emaNow) bias = 'BEARISH';

  return { bias, price, vwap: vwapNow, ema: emaNow, structure: hh && hl ? 'HH+HL' : ll && lh ? 'LL+LH' : 'MIXED' };
}

// ═══════════════════════════════════════════════════
// STEP 2: 15M CONFIRMATION — trend + key levels
// ═══════════════════════════════════════════════════
function get15MConfirmation(data15m, dateStr, bias1h) {
  const idx = filterDay(data15m, dateStr, 570, 960);
  if (idx.length < 5) return null;
  const h = idx.map(i => data15m.highs[i]), l = idx.map(i => data15m.lows[i]);
  const c = idx.map(i => data15m.closes[i]), v = idx.map(i => data15m.volumes[i]);
  const o = idx.map(i => data15m.opens[i]);
  const vw = vwapCalc(h, l, c, v);
  const e9 = ema(c, 9), e21 = ema(c, 21);
  const len = c.length;

  // Trend alignment with 1H
  const price = c[len - 1];
  const trendAligned = bias1h === 'BULLISH' ? (e9[len - 1] > e21[len - 1] && price > vw[len - 1])
    : bias1h === 'BEARISH' ? (e9[len - 1] < e21[len - 1] && price < vw[len - 1]) : false;

  // Key levels from 15M swings
  const levels = swingLevels(h, l, 0, len);

  // Order Blocks on 15M
  const obs = [];
  for (let i = 2; i < len; i++) {
    if (!o[i] || !c[i] || !o[i - 1] || !c[i - 1]) continue;
    const bigBody = Math.abs(c[i] - o[i]);
    const avgBody = c.slice(Math.max(0, i - 5), i).reduce((s, cc, j) => s + Math.abs((cc || 0) - (o[Math.max(0, i - 5) + j] || 0)), 0) / 5;
    if (bigBody > avgBody * 1.5) {
      // displacement candle — OB is the candle before
      if (c[i] > o[i] && c[i - 1] < o[i - 1]) obs.push({ type: 'BULL_OB', high: h[i - 1], low: l[i - 1], idx: i - 1 });
      if (c[i] < o[i] && c[i - 1] > o[i - 1]) obs.push({ type: 'BEAR_OB', high: h[i - 1], low: l[i - 1], idx: i - 1 });
    }
  }

  return { confirmed: trendAligned, price, vwap: vw[len - 1], levels, obs, e9: e9[len - 1], e21: e21[len - 1] };
}

// ═══════════════════════════════════════════════════
// STEP 3: 5M SETUP — sweep, MSS, FVG
// ═══════════════════════════════════════════════════
function get5MSetups(data5m, dateStr, bias1h, levels15m) {
  const idx = filterDay(data5m, dateStr, 570, 960);
  if (idx.length < 10) return [];
  const h = idx.map(i => data5m.highs[i]), l = idx.map(i => data5m.lows[i]);
  const c = idx.map(i => data5m.closes[i]), o = idx.map(i => data5m.opens[i]);
  const v = idx.map(i => data5m.volumes[i]);
  const vw = vwapCalc(h, l, c, v);
  const len = c.length;

  const setups = [];

  for (let j = 8; j < len - 3; j++) {
    const candleMin = getMinET(data5m.timestamps[idx[j]]);
    // Morning KZ (9:35-11:00) or Power Hour (14:00-15:30)
    if (!((candleMin >= 575 && candleMin <= 660) || (candleMin >= 840 && candleMin <= 930))) continue;
    const kz = candleMin <= 660 ? 'MORNING' : 'POWER_HOUR';

    const price = c[j];
    if (!price) continue;

    // Check VWAP alignment
    const vwapNow = vw[j];
    const vwapOk = bias1h === 'BULLISH' ? price > vwapNow : bias1h === 'BEARISH' ? price < vwapNow : false;
    if (!vwapOk) continue;

    // 5M swing levels
    const levels5 = swingLevels(h, l, Math.max(0, j - 20), j);
    // Combine with 15M levels mapped to approximate price zones
    const allLevels = [...levels5];
    for (const lv of levels15m) {
      allLevels.push({ type: lv.type, price: lv.price, idx: -1 });
    }

    // Sweep detection (last 3 candles)
    let sweep = null;
    for (let k = Math.max(j - 3, 0); k <= j; k++) {
      if (!c[k] || !o[k] || !h[k] || !l[k]) continue;
      const body = Math.abs(c[k] - o[k]);
      const wickDn = Math.min(c[k], o[k]) - l[k];
      const wickUp = h[k] - Math.max(c[k], o[k]);
      for (const lv of allLevels) {
        if (lv.type === 'LOW' && l[k] < lv.price && c[k] > lv.price && wickDn > body * 0.5)
          sweep = { type: 'BULL', level: +lv.price.toFixed(2), sweepLow: +l[k].toFixed(2), candleIdx: k };
        if (lv.type === 'HIGH' && h[k] > lv.price && c[k] < lv.price && wickUp > body * 0.5)
          sweep = { type: 'BEAR', level: +lv.price.toFixed(2), sweepHigh: +h[k].toFixed(2), candleIdx: k };
      }
    }

    // Bias filter
    if (sweep && bias1h === 'BULLISH' && sweep.type !== 'BULL') continue;
    if (sweep && bias1h === 'BEARISH' && sweep.type !== 'BEAR') continue;

    // MSS detection (look 12 candles after sweep)
    let mss = false;
    if (sweep) {
      if (sweep.type === 'BULL') {
        let recentHigh = -Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 10); k < sweep.candleIdx; k++) { if (h[k] > recentHigh) recentHigh = h[k]; }
        for (let k = sweep.candleIdx + 1; k <= Math.min(j, sweep.candleIdx + 12); k++) { if (h[k] > recentHigh) { mss = true; break; } }
      } else {
        let recentLow = Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 10); k < sweep.candleIdx; k++) { if (l[k] < recentLow) recentLow = l[k]; }
        for (let k = sweep.candleIdx + 1; k <= Math.min(j, sweep.candleIdx + 12); k++) { if (l[k] < recentLow) { mss = true; break; } }
      }
    }

    // FVG detection
    let fvg = null;
    for (let k = Math.max(2, j - 4); k <= j; k++) {
      if (!h[k] || !l[k] || !h[k - 2] || !l[k - 2]) continue;
      if (l[k] > h[k - 2] && (l[k] - h[k - 2]) > 0.03) fvg = { type: 'BULL_FVG', top: l[k], bottom: h[k - 2] };
      if (h[k] < l[k - 2] && (l[k - 2] - h[k]) > 0.03) fvg = { type: 'BEAR_FVG', top: l[k - 2], bottom: h[k] };
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
      const wasBelowVwap = c[j - 3] < vw[j - 3] && c[j - 2] < vw[j - 2];
      if (wasBelowVwap && c[j] > vw[j] && bias1h === 'BULLISH') vwapReclaim = true;
      const wasAboveVwap = c[j - 3] > vw[j - 3] && c[j - 2] > vw[j - 2];
      if (wasAboveVwap && c[j] < vw[j] && bias1h === 'BEARISH') vwapReclaim = true;
    }

    // RVOL
    const avgVol = v.slice(Math.max(0, j - 20), j).filter(x => x > 0).reduce((a, b) => a + b, 0) / 20;
    const rvol = avgVol ? +((v[j] || 0) / avgVol).toFixed(2) : 0;

    // Determine setup type
    let setupType = 'NONE';
    if (sweep && mss && (fvg || displacement)) setupType = 'SWEEP_MSS_FVG';
    else if (sweep && mss) setupType = 'SWEEP_MSS';
    else if (vwapReclaim && displacement) setupType = 'VWAP_RECLAIM';
    else if (sweep && displacement) setupType = 'SWEEP_DISP';

    if (setupType === 'NONE') continue;

    setups.push({
      candleIdx5: j, ts: data5m.timestamps[idx[j]], price: +price.toFixed(2),
      sweep, mss, fvg, displacement, vwapReclaim, vwapOk, rvol,
      setupType, kz, vwap: vwapNow,
    });
  }
  return setups;
}

// ═══════════════════════════════════════════════════
// STEP 4: 1M ENTRY — precise entry with confirmation
// ═══════════════════════════════════════════════════
function enter1M(data1m, dateStr, setup, bias1h, spyD, vixD) {
  const idx = filterDay(data1m, dateStr, 575, 955);
  if (idx.length < 20) return null;
  const h = idx.map(i => data1m.highs[i]), l = idx.map(i => data1m.lows[i]);
  const c = idx.map(i => data1m.closes[i]), o = idx.map(i => data1m.opens[i]);

  // Find 1min candle at or after setup time
  let startIdx = -1;
  for (let m = 0; m < idx.length; m++) {
    if (data1m.timestamps[idx[m]] >= setup.ts) { startIdx = m; break; }
  }
  if (startIdx < 0 || startIdx >= idx.length - 15) return null;

  // SPY/VIX convergence check
  let spyOk = false, vixOk = false;
  if (spyD) {
    let si = -1;
    for (let i = spyD.timestamps.length - 1; i >= 0; i--) { if (spyD.timestamps[i] <= setup.ts) { si = i; break; } }
    if (si >= 3 && spyD.closes[si] != null && spyD.closes[si - 3] != null) {
      const chg = spyD.closes[si] - spyD.closes[si - 3];
      spyOk = bias1h === 'BULLISH' ? chg > 0 : chg < 0;
    }
  }
  if (vixD) {
    let vi = -1;
    for (let i = vixD.timestamps.length - 1; i >= 0; i--) { if (vixD.timestamps[i] <= setup.ts) { vi = i; break; } }
    if (vi >= 3 && vixD.closes[vi] != null && vixD.closes[vi - 3] != null) {
      const chg = vixD.closes[vi] - vixD.closes[vi - 3];
      vixOk = bias1h === 'BULLISH' ? chg < 0 : chg > 0;
    }
  }

  // SCORING
  let score = 0;
  const bd = {};
  bd.bias1h = 1; score += 1; // already filtered
  if (setup.sweep) { score += 2; bd.sweep = 2; } else bd.sweep = 0;
  if (setup.mss) { score += 2; bd.mss = 2; } else bd.mss = 0;
  if (setup.vwapOk) { score += 1; bd.vwap = 1; } else bd.vwap = 0;
  if (setup.fvg) { score += 1; bd.fvg = 1; } else bd.fvg = 0;
  if (setup.displacement) { score += 1; bd.disp = 1; } else bd.disp = 0;
  if (setup.vwapReclaim) { score += 1; bd.reclaim = 1; } else bd.reclaim = 0;
  if (spyOk) { score += 1; bd.spy = 1; } else bd.spy = 0;
  if (vixOk) { score += 1; bd.vix = 1; } else bd.vix = 0;
  if (setup.rvol >= 1.5) { score += 1; bd.rvol = 1; } else bd.rvol = 0;

  if (score < 5) return null;

  // 1min confirmation: look for candle closing in direction within 5 candles
  const dir = bias1h === 'BULLISH' ? 'CALL' : 'PUT';
  let entryCandle = -1;
  for (let m = startIdx; m < Math.min(startIdx + 5, idx.length); m++) {
    if (!c[m] || !o[m]) continue;
    if (dir === 'CALL' && c[m] > o[m] && c[m] > c[Math.max(0, m - 1)]) { entryCandle = m; break; }
    if (dir === 'PUT' && c[m] < o[m] && c[m] < c[Math.max(0, m - 1)]) { entryCandle = m; break; }
  }
  if (entryCandle < 0) return null;

  const entry = +c[entryCandle].toFixed(2);
  const hora = new Date(data1m.timestamps[idx[entryCandle]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

  return { dir, entry, entryCandle, hora, score, bd, spyOk, vixOk, setup: setup.setupType, kz: setup.kz, rvol: setup.rvol, h, l, c, o, idxLen: idx.length };
}

// ═══════════════════════════════════════════════════
// RUN BACKTEST
// ═══════════════════════════════════════════════════
async function backtestDay(dateStr, allData, spyD5, vixD5) {
  const trades = [];

  for (const ticker of TICKERS) {
    const d1h = allData[ticker]?.['1h'];
    const d15m = allData[ticker]?.['15m'];
    const d5m = allData[ticker]?.['5m'];
    const d1m = allData[ticker]?.['1m'];
    if (!d1h || !d15m || !d5m || !d1m) continue;

    // STEP 1: 1H Bias
    const bias = get1HBias(d1h, dateStr);
    if (!bias || bias.bias === 'NEUTRAL') continue;

    // STEP 2: 15M Confirmation
    const conf = get15MConfirmation(d15m, dateStr, bias.bias);
    if (!conf || !conf.confirmed) continue;

    // STEP 3: 5M Setups
    const setups = get5MSetups(d5m, dateStr, bias.bias, conf.levels);
    if (setups.length === 0) continue;

    // STEP 4: 1M Entry — take first valid setup per ticker
    let traded = false;
    for (const setup of setups) {
      if (traded) break;

      const entryResult = enter1M(d1m, dateStr, setup, bias.bias, spyD5, vixD5);
      if (!entryResult) continue;

      const { dir, entry, entryCandle, hora, score, bd, spyOk, vixOk, kz, rvol, h, l, c, o, idxLen } = entryResult;

      // Test TP multipliers
      const tpMults = [2, 3];
      for (const tpM of tpMults) {
        const sl = dir === 'CALL' ? +(entry - FIXED_SL).toFixed(2) : +(entry + FIXED_SL).toFixed(2);
        const tp = dir === 'CALL' ? +(entry + FIXED_SL * tpM).toFixed(2) : +(entry - FIXED_SL * tpM).toFixed(2);

        let exitPrice = null, resultado = 'CIERRE';
        for (let f = entryCandle + 1; f < idxLen; f++) {
          if (dir === 'CALL') {
            if (l[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; }
            if (h[f] >= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
          } else {
            if (h[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; }
            if (l[f] <= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
          }
        }
        if (!exitPrice) { exitPrice = c[idxLen - 1] || entry; }

        const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
        trades.push({
          fecha: dateStr, hora, ticker, dir, entry, sl, tp, tpMult: tpM,
          exit: +exitPrice.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
          resultado, score, kz, rvol, spyOk, vixOk,
          bias1h: bias.bias, bias1hStructure: bias.structure,
          conf15m: conf.confirmed, setupType: setup.setupType,
          scoring: bd,
        });
      }
      traded = true;
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
  const pf = losses.length && losses.reduce((s, t) => s + t.pnlC, 0) !== 0 ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';
  return { total: trades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  BACKTEST ICT SMART MONEY v3 — 4-Timeframe');
  console.log('  1H=Bias | 15M=Confirm | 5M=Setup | 1M=Entry');
  console.log('  Morning KZ + Power Hour | Score >= 5 | SL $1.00');
  console.log('  Tickers: ' + TICKERS.join(', '));
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('Fetching 4 timeframes for 8 tickers...\n');

  const allData = {};
  for (const t of TICKERS) {
    process.stdout.write(`  ${t}...`);
    allData[t] = {
      '1h': await fetchYahoo(t, '1h', '5d'),
      '15m': await fetchYahoo(t, '15m', '5d'),
      '5m': await fetchYahoo(t, '5m', '5d'),
      '1m': await fetchYahoo(t, '1m', '5d'),
    };
    const ok = Object.values(allData[t]).every(d => d != null);
    console.log(ok ? ' ✅' : ' ⚠️');
  }

  const spyD5 = allData['SPY']?.['5m'] || await fetchYahoo('SPY', '5m', '5d');
  const vixD5 = await fetchYahoo('^VIX', '5m', '5d');

  // Get dates
  const allTs = [];
  for (const t of TICKERS) { if (allData[t]?.['5m']) allTs.push(...allData[t]['5m'].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`\nDias: ${dates.join(', ')}\n`);

  // Run
  const allTrades = [];
  for (const d of dates) {
    const dt = await backtestDay(d, allData, spyD5, vixD5);
    allTrades.push(...dt);
  }

  if (allTrades.length === 0) {
    console.log('❌ No trades encontrados.\n');
    return;
  }

  // Compare TP ratios
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION POR R:R');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`${'Config'.padEnd(28)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'W'.padEnd(4)} ${'L'.padEnd(4)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} Cuenta`);
  console.log('─'.repeat(95));

  let bestPnl = -Infinity, bestTpM = 2;
  for (const tpM of [2, 3]) {
    const group = allTrades.filter(t => t.tpMult === tpM);
    const s = summarize(group);
    const pnlStr = (s.totalC >= 0 ? '+$' : '-$') + Math.abs(s.totalC);
    const star = s.totalC > bestPnl ? ' ⭐' : '';
    if (s.totalC > bestPnl) { bestPnl = s.totalC; bestTpM = tpM; }
    console.log(`SL $1.00 | TP 1:${tpM} ($${(1 * tpM).toFixed(2)})`.padEnd(28) + ` ${String(s.total).padEnd(8)} ${(s.wr + '%').padEnd(6)} ${String(s.wins).padEnd(4)} ${String(s.losses).padEnd(4)} ${pnlStr.padEnd(10)} +$${s.avgW.toString().padEnd(6)} $${s.avgL.toString().padEnd(7)} ${s.pf.padEnd(6)} $${(2000 + s.totalC).toLocaleString()}${star}`);
  }

  // Detail for best
  const best = allTrades.filter(t => t.tpMult === bestTpM);
  const bs = summarize(best);
  console.log(`\n═══════════════════════════════════════════════════════════════════`);
  console.log(`  MEJOR: SL $1.00 | TP 1:${bestTpM} | ${bs.wins}W ${bs.losses}L | ${bs.wr}% WR | PF ${bs.pf}`);
  console.log(`═══════════════════════════════════════════════════════════════════\n`);

  console.log(`${'Fecha'.padEnd(12)} ${'Hora'.padEnd(8)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(10)} ${'SL'.padEnd(10)} ${'TP'.padEnd(10)} ${'Exit'.padEnd(10)} ${'$Cont'.padEnd(8)} ${'Sc'.padEnd(5)} ${'KZ'.padEnd(8)} ${'Bias1H'.padEnd(8)} Setup`);
  console.log('─'.repeat(110));
  for (const t of best) {
    const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
    const res = t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪';
    console.log(`${t.fecha.padEnd(12)} ${t.hora.padEnd(8)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${t.entry.toString().padEnd(9)} $${t.sl.toString().padEnd(9)} $${t.tp.toString().padEnd(9)} $${t.exit.toString().padEnd(9)} ${pnlCStr.padEnd(8)} ${(t.score + '').padEnd(5)} ${t.kz.slice(0,7).padEnd(8)} ${t.bias1h.slice(0,7).padEnd(8)} ${res} ${t.setupType}`);
  }

  // Per day
  console.log('\n── Por Dia ──');
  for (const d of dates) {
    const dt = best.filter(t => t.fecha === d);
    if (dt.length === 0) { console.log(`  ${d}: Sin trades`); continue; }
    const dw = dt.filter(t => t.pnl > 0).length;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    const tickers = [...new Set(dt.map(t => t.ticker))].join(',');
    console.log(`  ${d}: ${dt.length} trades (${tickers}) | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp}`);
  }

  // Per ticker
  console.log('\n── Por Ticker ──');
  for (const tk of TICKERS) {
    const dt = best.filter(t => t.ticker === tk);
    if (dt.length === 0) { console.log(`  ${tk}: Sin trades`); continue; }
    const s = summarize(dt);
    console.log(`  ${tk.padEnd(5)}: ${s.total} trades | ${s.wr}% WR | ${s.totalC >= 0 ? '+' : ''}$${s.totalC} | PF ${s.pf}`);
  }

  // Scoring breakdown
  console.log('\n── Scoring Breakdown ──');
  const avgSc = {};
  for (const t of best) {
    for (const [k, v] of Object.entries(t.scoring)) {
      if (!avgSc[k]) avgSc[k] = { sum: 0, n: 0, hit: 0 };
      avgSc[k].sum += v; avgSc[k].n++; if (v > 0) avgSc[k].hit++;
    }
  }
  for (const [k, v] of Object.entries(avgSc)) {
    console.log(`  ${k.padEnd(8)} hit ${v.hit}/${v.n} (${Math.round(v.hit / v.n * 100)}%)`);
  }

  // Setup type breakdown
  console.log('\n── Setup Types ──');
  const stypes = {};
  for (const t of best) { stypes[t.setupType] = (stypes[t.setupType] || 0) + 1; }
  for (const [k, v] of Object.entries(stypes)) {
    const st = best.filter(t => t.setupType === k);
    const sw = st.filter(t => t.pnl > 0).length;
    console.log(`  ${k.padEnd(20)} ${v} trades | ${Math.round(sw / v * 100)}% WR`);
  }

  console.log('');
}

main().catch(e => console.error('Error:', e.message));
