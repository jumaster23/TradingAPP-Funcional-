// Test TODAY with: merge levels + direction lock + daily trend

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return { timestamps: result.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getStop(price) {
  if (price < 100) return 0.50;
  if (price < 250) return 1.0;
  if (price < 400) return 1.5;
  if (price < 550) return 2.0;
  return 2.5;
}

function calcEMA(arr, period) {
  const k = 2 / (period + 1);
  const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) ema.push(arr[i] != null ? arr[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
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
  let maxFav = 0;
  for (let j = startIdx + 1; j <= endIdx; j++) {
    const h = data.highs[j], l = data.lows[j];
    if (h == null || l == null) continue;
    if (direction === 'CALL') {
      maxFav = Math.max(maxFav, h - entry);
      if (h >= entry + stopDist && !beTriggered) { stop = entry; beTriggered = true; }
      if (l <= stop) return { pnl: stop - entry, type: beTriggered ? 'BE' : 'STOP', maxFav, exitPrice: stop };
      if (h >= target) return { pnl: target - entry, type: 'TARGET', maxFav, exitPrice: target };
    } else {
      maxFav = Math.max(maxFav, entry - l);
      if (entry - l >= stopDist && !beTriggered) { stop = entry; beTriggered = true; }
      if (h >= stop) return { pnl: entry - stop, type: beTriggered ? 'BE' : 'STOP', maxFav, exitPrice: stop };
      if (l <= target) return { pnl: entry - target, type: 'TARGET', maxFav, exitPrice: target };
    }
  }
  const exitP = data.closes[endIdx] || entry;
  return { pnl: direction === 'CALL' ? exitP - entry : entry - exitP, type: 'OPEN', maxFav, exitPrice: exitP };
}

function checkConvergence1m(nq1m, spx1m, targetTs, direction) {
  if (!nq1m || !spx1m) return false;
  function check(data) {
    let idx = -1;
    for (let i = data.timestamps.length - 1; i >= 0; i--) {
      if (data.timestamps[i] <= targetTs) { idx = i; break; }
    }
    if (idx < 3) return false;
    const c = data.closes;
    if (c[idx] == null || c[idx-1] == null || c[idx-3] == null) return false;
    const price = c[idx], t3 = price - c[idx-3], t1 = price - c[idx-1], th = price * 0.00003;
    if (direction === 'CALL') return t3 > th && t1 >= 0;
    return t3 < -th && t1 <= 0;
  }
  return check(nq1m) && check(spx1m);
}

// MERGE LEVELS — within 0.5% keep highest priority
function mergeLevels(levels) {
  const priority = { PDH: 3, PDL: 3, PMH: 2, PML: 2, MH: 1, ML: 1 };
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const merged = [];
  const used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    let best = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const dist = Math.abs(sorted[j].price - best.price) / best.price;
      if (dist < 0.005) {
        if ((priority[sorted[j].name] || 0) > (priority[best.name] || 0)) {
          used.add(i); best = sorted[j];
        }
        used.add(j);
      }
    }
    merged.push(best);
  }
  return merged;
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nTRADES DE HOY: ${today} — Con merge niveles + direction lock + tendencia diaria`);
  console.log('='.repeat(80));

  const [nq1m, spx1m] = await Promise.all([
    fetchChart('NQ=F', '1m', '5d'),
    fetchChart('^GSPC', '1m', '5d'),
  ]);

  const allTrades = [];
  const dirLock = {}; // ticker -> { dir, time }

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '2d'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data5m) { console.log('skip'); continue; }

    const dCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
    const dEma10 = calcEMA(dCloses, 10);
    let dayTrend = 'NEUTRAL';
    if (dCloses.length >= 12) {
      const idx = dCloses.length - 1;
      if (dCloses[idx] > dEma10[idx] && dCloses[idx-1] > dCloses[idx-2]) dayTrend = 'UP';
      else if (dCloses[idx] < dEma10[idx] && dCloses[idx-1] < dCloses[idx-2]) dayTrend = 'DOWN';
    }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort();
    const todayKey = dayKeys.find(k => k === today);
    const yesterdayKey = dayKeys[dayKeys.indexOf(todayKey) - 1];
    if (!todayKey || !yesterdayKey) { console.log('no data'); continue; }

    const todayIndices = days[todayKey];
    const yesterdayIndices = days[yesterdayKey];

    let rawLevels = [];
    let pdh = -Infinity, pdl = Infinity;
    for (const pi of yesterdayIndices) {
      const m = getMinutesET(data5m.timestamps[pi]);
      if (m >= 570 && m < 960) {
        if (data5m.highs[pi] != null && data5m.highs[pi] > pdh) pdh = data5m.highs[pi];
        if (data5m.lows[pi] != null && data5m.lows[pi] < pdl) pdl = data5m.lows[pi];
      }
    }
    if (pdh !== -Infinity) {
      rawLevels.push({ name: 'PDH', price: +pdh.toFixed(2) });
      rawLevels.push({ name: 'PDL', price: +pdl.toFixed(2) });
    }

    let pmh = -Infinity, pml = Infinity, pmc = 0;
    for (const ci of todayIndices) {
      const m = getMinutesET(data5m.timestamps[ci]);
      if (m >= 240 && m < 570) {
        if (data5m.highs[ci] != null && data5m.highs[ci] > pmh) pmh = data5m.highs[ci];
        if (data5m.lows[ci] != null && data5m.lows[ci] < pml) pml = data5m.lows[ci];
        pmc++;
      }
    }
    if (pmc >= 3 && pmh !== -Infinity) {
      rawLevels.push({ name: 'PMH', price: +pmh.toFixed(2) });
      rawLevels.push({ name: 'PML', price: +pml.toFixed(2) });
    }

    const levels = mergeLevels(rawLevels);
    const currentPrice = data5m.closes[todayIndices[todayIndices.length - 1]];
    console.log(`trend=${dayTrend} $${currentPrice?.toFixed(2)} raw=${rawLevels.length} merged=${levels.length} → ${levels.map(l => `${l.name}=$${l.price}`).join(' ')}`);

    const regIndices = todayIndices.filter(ci => {
      const m = getMinutesET(data5m.timestamps[ci]);
      return m >= 575 && m < 955;
    });

    const touched = {};
    for (let ri = 1; ri < regIndices.length; ri++) {
      const ci = regIndices[ri];
      const prevCi = regIndices[ri - 1];
      const price = data5m.closes[ci];
      const h = data5m.highs[ci], l = data5m.lows[ci], o = data5m.opens[ci], c = data5m.closes[ci];
      if (!price || !h || !l || !o) continue;

      const body = Math.abs(c - o);
      const wickUp = h - Math.max(c, o);
      const wickDn = Math.min(c, o) - l;
      const stopDist = getStop(price);
      const prevH = data5m.highs[prevCi], prevL = data5m.lows[prevCi];
      const candleTs = data5m.timestamps[ci];
      const time = new Date(candleTs * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      for (const level of levels) {
        let dir = null, type = null;
        if (h > level.price && prevH != null && prevH <= level.price) { dir = 'CALL'; type = 'BRK'; }
        else if (l < level.price && prevL != null && prevL >= level.price) { dir = 'PUT'; type = 'BRK'; }
        else if (l <= level.price * 1.002 && c > level.price && wickDn > body * 2 && wickDn > 0.10) { dir = 'CALL'; type = 'REJ'; }
        else if (h >= level.price * 0.998 && c < level.price && wickUp > body * 2 && wickUp > 0.10) { dir = 'PUT'; type = 'REJ'; }

        if (!dir) continue;
        const tk = `${level.name}_${type}_${dir}`;
        if (touched[tk]) continue;

        // TREND FILTER
        if (dir === 'CALL' && dayTrend === 'DOWN') continue;
        if (dir === 'PUT' && dayTrend === 'UP') continue;

        // DIRECTION LOCK — 30min cooldown on opposite direction
        const lockKey = `${ticker}_lock`;
        const lock = dirLock[lockKey];
        if (lock && (candleTs - lock.time) < 30 * 60 && lock.dir !== dir) continue;

        // CONVERGENCE
        if (!checkConvergence1m(nq1m, spx1m, candleTs, dir)) continue;
        touched[tk] = true;

        // Lock this direction
        dirLock[lockKey] = { dir, time: candleTs };

        const lastIdx = regIndices[regIndices.length - 1];
        const res = simulateTrade(dir, price, stopDist, data5m, ci, lastIdx);

        allTrades.push({
          time, ticker, dir, type, level: level.name, levelPrice: level.price,
          entry: +price.toFixed(2),
          sl: +(dir === 'CALL' ? price - stopDist : price + stopDist).toFixed(2),
          tp: +(dir === 'CALL' ? price + stopDist * 3 : price - stopDist * 3).toFixed(2),
          be: +(dir === 'CALL' ? price + stopDist : price - stopDist).toFixed(2),
          exitPrice: +res.exitPrice.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type,
          result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : res.type === 'OPEN' ? 'OPEN' : 'LOSS',
          maxFav: +res.maxFav.toFixed(2), dayTrend,
        });
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`RESULTADO — ${allTrades.length} trades\n`);
  console.log(`${'Hora'.padEnd(9)} ${'Tkr'.padEnd(5)} ${'Dir'.padEnd(5)} ${'Tipo'.padEnd(4)} ${'Lvl'.padEnd(4)} ${'LvlPr'.padEnd(8)} ${'Entry'.padEnd(8)} ${'SL'.padEnd(8)} ${'TP'.padEnd(9)} ${'BE'.padEnd(8)} ${'Exit'.padEnd(8)} ${'PnL'.padEnd(8)} ${'Res'.padEnd(6)} ${'MaxF'.padEnd(6)} Trend`);
  console.log('-'.repeat(100));
  for (const t of allTrades) {
    console.log(
      `${t.time.padEnd(9)} ${t.ticker.padEnd(5)} ${t.dir.padEnd(5)} ${t.type.padEnd(4)} ${t.level.padEnd(4)} $${String(t.levelPrice).padEnd(7)} $${String(t.entry).padEnd(7)} $${String(t.sl).padEnd(7)} $${String(t.tp).padEnd(8)} $${String(t.be).padEnd(7)} $${String(t.exitPrice).padEnd(7)} ${(t.pnl >= 0 ? '+' : '')+t.pnl.toFixed(2).padStart(6)} ${t.result.padEnd(6)} $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend}`
    );
  }

  const w = allTrades.filter(t => t.result === 'WIN').length;
  const l = allTrades.filter(t => t.result === 'LOSS').length;
  const b = allTrades.filter(t => t.result === 'BE').length;
  const o = allTrades.filter(t => t.result === 'OPEN').length;
  const pnl = allTrades.filter(t => t.result !== 'OPEN').reduce((s, t) => s + t.pnl, 0);

  console.log(`\nTrades: ${allTrades.length} | W: ${w} | L: ${l} | BE: ${b} | Open: ${o} | PnL: $${pnl.toFixed(2)}`);
  console.log(`Antes (sin filtros): 12 trades, 2W 3L, -$4.60`);
}

run().catch(console.error);
