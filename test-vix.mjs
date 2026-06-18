// Test: Ultra Simple with SPX + VIX convergence (VIX inverse)
// CALL = SPX up + VIX down | PUT = SPX down + VIX up

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
    const end = now - i * 7 * 86400;
    const start = end - 7 * 86400;
    const data = await fetchChart(ticker, '1m', null, start, end);
    if (data && data.timestamps.length > 0) chunks.unshift(data);
    await new Promise(r => setTimeout(r, 300));
  }
  if (!chunks.length) return null;
  const merged = { timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
  const seen = new Set();
  for (const c of chunks) {
    for (let i = 0; i < c.timestamps.length; i++) {
      if (!seen.has(c.timestamps[i])) {
        seen.add(c.timestamps[i]);
        merged.timestamps.push(c.timestamps[i]);
        merged.opens.push(c.opens[i]);
        merged.highs.push(c.highs[i]);
        merged.lows.push(c.lows[i]);
        merged.closes.push(c.closes[i]);
        merged.volumes.push(c.volumes[i]);
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
  for (let i = 0; i < timestamps.length; i++) {
    const key = getDayKeyET(timestamps[i]);
    if (!days[key]) days[key] = [];
    days[key].push(i);
  }
  return days;
}

function simulateTrade(direction, entry, stopDist, data, startIdx, endIdx) {
  const target = direction === 'CALL' ? entry + stopDist * 3 : entry - stopDist * 3;
  let stop = direction === 'CALL' ? entry - stopDist : entry + stopDist;
  let beTriggered = false;
  for (let j = startIdx + 1; j <= endIdx; j++) {
    const h = data.highs[j], l = data.lows[j];
    if (h == null || l == null) continue;
    if (direction === 'CALL') {
      if (h >= entry + stopDist && !beTriggered) { stop = entry; beTriggered = true; }
      if (l <= stop) return { pnl: stop - entry, type: beTriggered ? 'BE' : 'STOP' };
      if (h >= target) return { pnl: target - entry, type: 'TARGET' };
    } else {
      if (entry - l >= stopDist && !beTriggered) { stop = entry; beTriggered = true; }
      if (h >= stop) return { pnl: entry - stop, type: beTriggered ? 'BE' : 'STOP' };
      if (l <= target) return { pnl: entry - target, type: 'TARGET' };
    }
  }
  const exitP = data.closes[endIdx] || entry;
  return { pnl: direction === 'CALL' ? exitP - entry : entry - exitP, type: 'EOD' };
}

function mergeLevels(levels) {
  const priority = { PDH: 3, PDL: 3, PMH: 2, PML: 2, MH: 1, ML: 1 };
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const merged = []; const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let best = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(sorted[j].price - best.price) / best.price < 0.005) {
        if ((priority[sorted[j].name] || 0) > (priority[best.name] || 0)) { used.add(i); best = sorted[j]; }
        used.add(j);
      }
    }
    merged.push(best);
  }
  return merged;
}

// === CONVERGENCE VARIANTS ===

// OLD: NQ + SPX (both same direction)
function checkNqSpx(nq1m, spx1m, ts, dir) {
  function check(data, direction, inverse) {
    let idx = -1;
    for (let i = data.timestamps.length - 1; i >= 0; i--) { if (data.timestamps[i] <= ts) { idx = i; break; } }
    if (idx < 3) return false;
    const c = data.closes;
    if (c[idx] == null || c[idx-1] == null || c[idx-3] == null) return false;
    const price = c[idx], t3 = price - c[idx-3], t1 = price - c[idx-1], th = price * 0.00003;
    if (inverse) {
      if (direction === 'CALL') return t3 < -th && t1 <= 0; // VIX DOWN for CALL
      return t3 > th && t1 >= 0; // VIX UP for PUT
    }
    if (direction === 'CALL') return t3 > th && t1 >= 0;
    return t3 < -th && t1 <= 0;
  }
  return check(nq1m, dir, false) && check(spx1m, dir, false);
}

// NEW: SPX + VIX (VIX is inverse — CALL needs VIX down, PUT needs VIX up)
function checkSpxVix(spx1m, vix1m, ts, dir) {
  function check(data, direction, inverse) {
    let idx = -1;
    for (let i = data.timestamps.length - 1; i >= 0; i--) { if (data.timestamps[i] <= ts) { idx = i; break; } }
    if (idx < 3) return false;
    const c = data.closes;
    if (c[idx] == null || c[idx-1] == null || c[idx-3] == null) return false;
    const price = c[idx], t3 = price - c[idx-3], t1 = price - c[idx-1], th = price * 0.00003;
    if (inverse) {
      if (direction === 'CALL') return t3 < -th && t1 <= 0; // VIX dropping = bullish
      return t3 > th && t1 >= 0; // VIX rising = bearish
    }
    if (direction === 'CALL') return t3 > th && t1 >= 0;
    return t3 < -th && t1 <= 0;
  }
  return check(spx1m, dir, false) && check(vix1m, dir, true);
}

async function run() {
  console.log('Fetching 1min data (4 weeks)...');
  const [nq1m, spx1m, vix1m] = await Promise.all([
    fetch1minMonth('NQ=F'),
    fetch1minMonth('^GSPC'),
    fetch1minMonth('^VIX'),
  ]);
  console.log(`NQ: ${nq1m?.timestamps.length || 0} | SPX: ${spx1m?.timestamps.length || 0} | VIX: ${vix1m?.timestamps.length || 0}`);

  const results = { nqSpx: [], spxVix: [] };

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
    const dTimestamps = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    function getDayTrend(dayKey) {
      if (dCloses.length < 12) return 'NEUTRAL';
      const ts = new Date(dayKey + 'T12:00:00').getTime() / 1000;
      let idx = -1;
      for (let i = dTimestamps.length - 1; i >= 0; i--) { if (dTimestamps[i] <= ts + 86400) { idx = i; break; } }
      if (idx < 10 || !dEma10[idx]) return 'NEUTRAL';
      if (dCloses[idx] > dEma10[idx] && dCloses[idx-1] > dCloses[idx-2]) return 'UP';
      if (dCloses[idx] < dEma10[idx] && dCloses[idx-1] < dCloses[idx-2]) return 'DOWN';
      return 'NEUTRAL';
    }

    let tickerCount = 0;
    for (let di = 1; di < dayKeys.length; di++) {
      const dayKey = dayKeys[di], prevDayKey = dayKeys[di-1];
      const indices = days[dayKey], prevIndices = days[prevDayKey];
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
      const dayTrend = getDayTrend(dayKey);
      const touched1 = {}, touched2 = {};
      const dirLock1 = {}, dirLock2 = {};

      const regIndices = indices.filter(ci => {
        const m = getMinutesET(data5m.timestamps[ci]);
        return m >= 575 && m < 955;
      });

      for (let ri = 1; ri < regIndices.length; ri++) {
        const ci = regIndices[ri], prevCi = regIndices[ri-1];
        const price = data5m.closes[ci], h = data5m.highs[ci], l = data5m.lows[ci], o = data5m.opens[ci], c = data5m.closes[ci];
        if (!price || !h || !l || !o) continue;
        const body = Math.abs(c - o), wickUp = h - Math.max(c, o), wickDn = Math.min(c, o) - l;
        const stopDist = getStop(price);
        const prevH = data5m.highs[prevCi], prevL = data5m.lows[prevCi];
        const candleTs = data5m.timestamps[ci];

        for (const level of levels) {
          let dir = null, type = null;
          if (h > level.price && prevH != null && prevH <= level.price) { dir = 'CALL'; type = 'BRK'; }
          else if (l < level.price && prevL != null && prevL >= level.price) { dir = 'PUT'; type = 'BRK'; }
          else if (l <= level.price * 1.002 && c > level.price && wickDn > body * 2 && wickDn > 0.10) { dir = 'CALL'; type = 'REJ'; }
          else if (h >= level.price * 0.998 && c < level.price && wickUp > body * 2 && wickUp > 0.10) { dir = 'PUT'; type = 'REJ'; }

          if (!dir) continue;
          if (dir === 'CALL' && dayTrend === 'DOWN') continue;
          if (dir === 'PUT' && dayTrend === 'UP') continue;

          const tk = `${level.name}_${type}_${dir}`;
          const endOfDay = regIndices[regIndices.length - 1];

          // NQ+SPX variant
          if (!touched1[tk]) {
            const lk = dirLock1[ticker];
            const locked = lk && (candleTs - lk.time) < 1800 && lk.dir !== dir;
            if (!locked && checkNqSpx(nq1m, spx1m, candleTs, dir)) {
              touched1[tk] = true;
              dirLock1[ticker] = { dir, time: candleTs };
              const res = simulateTrade(dir, price, stopDist, data5m, ci, endOfDay);
              results.nqSpx.push({ date: dayKey, ticker, dir, type, level: level.name, entry: +price.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type, result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : 'LOSS' });
              tickerCount++;
            }
          }

          // SPX+VIX variant
          if (!touched2[tk]) {
            const lk = dirLock2[ticker];
            const locked = lk && (candleTs - lk.time) < 1800 && lk.dir !== dir;
            if (!locked && checkSpxVix(spx1m, vix1m, candleTs, dir)) {
              touched2[tk] = true;
              dirLock2[ticker] = { dir, time: candleTs };
              const res = simulateTrade(dir, price, stopDist, data5m, ci, endOfDay);
              results.spxVix.push({ date: dayKey, ticker, dir, type, level: level.name, entry: +price.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type, result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : 'LOSS' });
            }
          }
        }
      }
    }
    console.log(`${tickerCount} trades`);
    await new Promise(r => setTimeout(r, 200));
  }

  function stats(trades, label) {
    const w = trades.filter(t => t.result === 'WIN').length;
    const l = trades.filter(t => t.result === 'LOSS').length;
    const b = trades.filter(t => t.result === 'BE').length;
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const gw = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const days = new Set(trades.map(t => t.date)).size;
    const pf = gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? '∞' : '0';
    const nlr = trades.length ? ((1 - l / trades.length) * 100).toFixed(1) : 0;

    console.log(`\n=== ${label} ===`);
    console.log(`Trades: ${trades.length} | Wins: ${w} | Losses: ${l} | BE: ${b}`);
    console.log(`WR: ${trades.length ? ((w/trades.length)*100).toFixed(1) : 0}% | NLR: ${nlr}% | PF: ${pf}`);
    console.log(`PnL: $${pnl.toFixed(2)} | Avg: $${trades.length ? (pnl/trades.length).toFixed(2) : 0}/trade`);
    console.log(`Days: ${days} | Trades/day: ${days ? (trades.length/days).toFixed(1) : 0}`);
    return { trades: trades.length, w, l, b, pnl, pf, nlr, days };
  }

  console.log('\n' + '='.repeat(70));
  console.log('COMPARACION: NQ+SPX vs SPX+VIX (con tendencia + merge + dir lock)');
  console.log('='.repeat(70));

  const s1 = stats(results.nqSpx, 'NQ + SPX (actual)');
  const s2 = stats(results.spxVix, 'SPX + VIX (nuevo)');

  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN');
  console.log('='.repeat(70));
  console.log(`NQ+SPX:  ${s1.trades} trades, PF ${s1.pf}, $${s1.pnl.toFixed(2)}, NLR ${s1.nlr}%, ${(s1.trades/s1.days).toFixed(1)}/day`);
  console.log(`SPX+VIX: ${s2.trades} trades, PF ${s2.pf}, $${s2.pnl.toFixed(2)}, NLR ${s2.nlr}%, ${(s2.trades/s2.days).toFixed(1)}/day`);
}

run().catch(console.error);
