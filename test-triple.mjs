// Test: Triple convergence QQQ + SPY + VIX (inverse)
// CALL = QQQ up + SPY up + VIX down
// PUT = QQQ down + SPY down + VIX up

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range, p1 = null, p2 = null) {
  let url;
  if (p1 && p2) url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true`;
  else url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return { timestamps: result.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

async function fetch1minMonth(ticker) {
  const now = Math.floor(Date.now() / 1000);
  const chunks = [];
  for (let i = 0; i < 4; i++) {
    const end = now - i * 7 * 86400, start = end - 7 * 86400;
    const data = await fetchChart(ticker, '1m', null, start, end);
    if (data && data.timestamps.length > 0) chunks.unshift(data);
    await new Promise(r => setTimeout(r, 300));
  }
  if (!chunks.length) return null;
  const merged = { timestamps: [], closes: [] };
  const seen = new Set();
  for (const c of chunks) {
    for (let i = 0; i < c.timestamps.length; i++) {
      if (!seen.has(c.timestamps[i])) {
        seen.add(c.timestamps[i]);
        merged.timestamps.push(c.timestamps[i]);
        merged.closes.push(c.closes[i]);
      }
    }
  }
  return merged;
}

function getStop(price) {
  if (price < 100) return 0.50;
  if (price < 250) return 1.0;
  if (price < 400) return 1.5;
  if (price < 550) return 2.0;
  return 2.5;
}

function calcEMA(arr, period) {
  const k = 2 / (period + 1); const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) ema.push(arr[i] != null ? arr[i] * k + ema[i-1] * (1-k) : ema[i-1]);
  return ema;
}

function getMinutesET(ts) {
  const d = new Date(ts * 1000);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

function getDayKeyET(ts) {
  const d = new Date(ts * 1000);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;
}

function groupByDay(timestamps) {
  const days = {};
  for (let i = 0; i < timestamps.length; i++) { const k = getDayKeyET(timestamps[i]); if (!days[k]) days[k] = []; days[k].push(i); }
  return days;
}

function simulateTrade(dir, entry, stopDist, data, startIdx, endIdx) {
  const target = dir === 'CALL' ? entry + stopDist * 3 : entry - stopDist * 3;
  let stop = dir === 'CALL' ? entry - stopDist : entry + stopDist;
  let be = false;
  for (let j = startIdx + 1; j <= endIdx; j++) {
    const h = data.highs[j], l = data.lows[j];
    if (h == null || l == null) continue;
    if (dir === 'CALL') {
      if (h >= entry + stopDist && !be) { stop = entry; be = true; }
      if (l <= stop) return { pnl: stop - entry, type: be ? 'BE' : 'STOP' };
      if (h >= target) return { pnl: target - entry, type: 'TARGET' };
    } else {
      if (entry - l >= stopDist && !be) { stop = entry; be = true; }
      if (h >= stop) return { pnl: entry - stop, type: be ? 'BE' : 'STOP' };
      if (l <= target) return { pnl: entry - target, type: 'TARGET' };
    }
  }
  const ep = data.closes[endIdx] || entry;
  return { pnl: dir === 'CALL' ? ep - entry : entry - ep, type: 'EOD' };
}

function mergeLevels(levels) {
  const pri = { PDH: 3, PDL: 3, PMH: 2, PML: 2, MH: 1, ML: 1 };
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const merged = []; const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue; let best = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(sorted[j].price - best.price) / best.price < 0.005) {
        if ((pri[sorted[j].name] || 0) > (pri[best.name] || 0)) { used.add(i); best = sorted[j]; }
        used.add(j);
      }
    }
    merged.push(best);
  }
  return merged;
}

// Check single index trend at timestamp
function checkIdx(data, ts, dir, inverse) {
  let idx = -1;
  for (let i = data.timestamps.length - 1; i >= 0; i--) { if (data.timestamps[i] <= ts) { idx = i; break; } }
  if (idx < 3) return false;
  const c = data.closes;
  if (c[idx] == null || c[idx-1] == null || c[idx-3] == null) return false;
  const price = c[idx], t3 = price - c[idx-3], t1 = price - c[idx-1], th = price * 0.00003;
  if (inverse) {
    return dir === 'CALL' ? (t3 < -th && t1 <= 0) : (t3 > th && t1 >= 0);
  }
  return dir === 'CALL' ? (t3 > th && t1 >= 0) : (t3 < -th && t1 <= 0);
}

async function run() {
  console.log('Fetching 1min data (4 weeks)...');
  const [nq1m, spx1m, spy1m, qqq1m, vix1m] = await Promise.all([
    fetch1minMonth('NQ=F'),
    fetch1minMonth('^GSPC'),
    fetch1minMonth('SPY'),
    fetch1minMonth('QQQ'),
    fetch1minMonth('^VIX'),
  ]);
  console.log(`NQ:${nq1m?.timestamps.length||0} SPX:${spx1m?.timestamps.length||0} SPY:${spy1m?.timestamps.length||0} QQQ:${qqq1m?.timestamps.length||0} VIX:${vix1m?.timestamps.length||0}`);

  // All convergence variants to test
  const variants = {
    'NQ+SPX':        (ts, dir) => checkIdx(nq1m, ts, dir, false) && checkIdx(spx1m, ts, dir, false),
    'SPX+VIX':       (ts, dir) => checkIdx(spx1m, ts, dir, false) && checkIdx(vix1m, ts, dir, true),
    'QQQ+SPY+VIX':   (ts, dir) => checkIdx(qqq1m, ts, dir, false) && checkIdx(spy1m, ts, dir, false) && checkIdx(vix1m, ts, dir, true),
    'SPY+VIX':       (ts, dir) => checkIdx(spy1m, ts, dir, false) && checkIdx(vix1m, ts, dir, true),
    'QQQ+VIX':       (ts, dir) => checkIdx(qqq1m, ts, dir, false) && checkIdx(vix1m, ts, dir, true),
  };

  const results = {};
  for (const k of Object.keys(variants)) results[k] = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '1mo'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data5m || data5m.timestamps.length < 50) { console.log('skip'); continue; }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort();
    const dCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
    const dTs = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    function getDayTrend(dk) {
      if (dCloses.length < 12) return 'NEUTRAL';
      const ts = new Date(dk + 'T12:00:00').getTime() / 1000;
      let idx = -1;
      for (let i = dTs.length - 1; i >= 0; i--) { if (dTs[i] <= ts + 86400) { idx = i; break; } }
      if (idx < 10 || !dEma10[idx]) return 'NEUTRAL';
      if (dCloses[idx] > dEma10[idx] && dCloses[idx-1] > dCloses[idx-2]) return 'UP';
      if (dCloses[idx] < dEma10[idx] && dCloses[idx-1] < dCloses[idx-2]) return 'DOWN';
      return 'NEUTRAL';
    }

    let tc = 0;
    for (let di = 1; di < dayKeys.length; di++) {
      const dk = dayKeys[di], pdk = dayKeys[di-1];
      const indices = days[dk], prevIndices = days[pdk];
      if (!prevIndices || indices.length < 15) continue;

      let rawLevels = [];
      let pdh = -Infinity, pdl = Infinity;
      for (const pi of prevIndices) {
        const m = getMinutesET(data5m.timestamps[pi]);
        if (m >= 570 && m < 960) {
          if (data5m.highs[pi] != null && data5m.highs[pi] > pdh) pdh = data5m.highs[pi];
          if (data5m.lows[pi] != null && data5m.lows[pi] < pdl) pdl = data5m.lows[pi];
        }
      }
      if (pdh !== -Infinity) { rawLevels.push({ name: 'PDH', price: +pdh.toFixed(2) }); rawLevels.push({ name: 'PDL', price: +pdl.toFixed(2) }); }

      let pmh = -Infinity, pml = Infinity, pmc = 0;
      for (const ci of indices) {
        const m = getMinutesET(data5m.timestamps[ci]);
        if (m >= 240 && m < 570) {
          if (data5m.highs[ci] != null && data5m.highs[ci] > pmh) pmh = data5m.highs[ci];
          if (data5m.lows[ci] != null && data5m.lows[ci] < pml) pml = data5m.lows[ci];
          pmc++;
        }
      }
      if (pmc >= 3 && pmh !== -Infinity) { rawLevels.push({ name: 'PMH', price: +pmh.toFixed(2) }); rawLevels.push({ name: 'PML', price: +pml.toFixed(2) }); }

      const levels = mergeLevels(rawLevels);
      if (!levels.length) continue;
      const dt = getDayTrend(dk);

      // Per-variant tracking
      const touched = {}, dirLock = {};
      for (const k of Object.keys(variants)) { touched[k] = {}; dirLock[k] = {}; }

      const regIdx = indices.filter(ci => { const m = getMinutesET(data5m.timestamps[ci]); return m >= 575 && m < 955; });

      for (let ri = 1; ri < regIdx.length; ri++) {
        const ci = regIdx[ri], pci = regIdx[ri-1];
        const price = data5m.closes[ci], h = data5m.highs[ci], l = data5m.lows[ci], o = data5m.opens[ci], c = data5m.closes[ci];
        if (!price || !h || !l || !o) continue;
        const body = Math.abs(c - o), wU = h - Math.max(c, o), wD = Math.min(c, o) - l;
        const sd = getStop(price);
        const pH = data5m.highs[pci], pL = data5m.lows[pci];
        const cts = data5m.timestamps[ci];

        for (const lv of levels) {
          let dir = null, type = null;
          if (h > lv.price && pH != null && pH <= lv.price) { dir = 'CALL'; type = 'BRK'; }
          else if (l < lv.price && pL != null && pL >= lv.price) { dir = 'PUT'; type = 'BRK'; }
          else if (l <= lv.price * 1.002 && c > lv.price && wD > body * 2 && wD > 0.10) { dir = 'CALL'; type = 'REJ'; }
          else if (h >= lv.price * 0.998 && c < lv.price && wU > body * 2 && wU > 0.10) { dir = 'PUT'; type = 'REJ'; }
          if (!dir) continue;
          if (dir === 'CALL' && dt === 'DOWN') continue;
          if (dir === 'PUT' && dt === 'UP') continue;

          const tk = `${lv.name}_${type}_${dir}`;
          const eod = regIdx[regIdx.length - 1];

          for (const [vName, vFn] of Object.entries(variants)) {
            if (touched[vName][tk]) continue;
            const lk = dirLock[vName][ticker];
            if (lk && (cts - lk.time) < 1800 && lk.dir !== dir) continue;
            if (!vFn(cts, dir)) continue;
            touched[vName][tk] = true;
            dirLock[vName][ticker] = { dir, time: cts };
            const res = simulateTrade(dir, price, sd, data5m, ci, eod);
            results[vName].push({ date: dk, ticker, dir, type, level: lv.name, entry: +price.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type, result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : 'LOSS' });
            if (vName === 'QQQ+SPY+VIX') tc++;
          }
        }
      }
    }
    console.log(`${tc} trades (triple)`);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n' + '='.repeat(80));
  console.log('COMPARACION DE CONVERGENCIAS — 1 mes, 10 tickers, tendencia + merge + dir lock');
  console.log('='.repeat(80));

  for (const [name, trades] of Object.entries(results)) {
    const w = trades.filter(t => t.result === 'WIN').length;
    const l = trades.filter(t => t.result === 'LOSS').length;
    const b = trades.filter(t => t.result === 'BE').length;
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const gw = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const days = new Set(trades.map(t => t.date)).size;
    const pf = gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? '∞' : '0';
    const nlr = trades.length ? ((1 - l / trades.length) * 100).toFixed(1) : 0;
    const tpd = days ? (trades.length / days).toFixed(1) : 0;

    console.log(`\n${name.padEnd(15)} | ${String(trades.length).padStart(3)} trades | ${String(w).padStart(2)}W ${String(l).padStart(2)}L ${String(b).padStart(2)}BE | WR ${((w/trades.length)*100).toFixed(0).padStart(2)}% | NLR ${nlr.padStart(5)}% | PF ${pf.padStart(5)} | $${pnl.toFixed(2).padStart(7)} | ${tpd}/day`);
  }
}

run().catch(console.error);
