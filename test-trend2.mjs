// Test v2: Uses 1-MINUTE data for convergence (matching real app)
// Yahoo gives max 7 days of 1min data, so we fetch NQ/SPX in 1min chunks

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range, period1 = null, period2 = null) {
  let url;
  if (period1 && period2) {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&period1=${period1}&period2=${period2}&includePrePost=true`;
  } else {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return {
    timestamps: result.timestamp || [],
    opens: q.open || [],
    highs: q.high || [],
    lows: q.low || [],
    closes: q.close || [],
    volumes: q.volume || [],
  };
}

// Fetch 1min data in 7-day chunks for a full month
async function fetch1minMonth(ticker) {
  const now = Math.floor(Date.now() / 1000);
  const chunks = [];
  for (let i = 0; i < 4; i++) {
    const end = now - i * 7 * 86400;
    const start = end - 7 * 86400;
    const data = await fetchChart(ticker, '1m', null, start, end);
    if (data && data.timestamps.length > 0) chunks.unshift(data);
    await new Promise(r => setTimeout(r, 300)); // rate limit
  }
  if (!chunks.length) return null;
  // Merge
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
  if (!arr || arr.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    ema.push(arr[i] != null ? arr[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
  }
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

// Check convergence using 1-MINUTE data (matching real app exactly)
// Looks at last 3 candles of 1min NQ/SPX relative to the given timestamp
function checkConvergence1m(nq1m, spx1m, targetTs, direction) {
  if (!nq1m || !spx1m) return false;

  function check(data) {
    // Find the latest 1min candle at or before targetTs
    let idx = -1;
    for (let i = data.timestamps.length - 1; i >= 0; i--) {
      if (data.timestamps[i] <= targetTs) { idx = i; break; }
    }
    if (idx < 3) return false;
    const c = data.closes;
    if (c[idx] == null || c[idx-1] == null || c[idx-3] == null) return false;

    const price = c[idx];
    const t3 = price - c[idx - 3]; // 3 candles back (3 minutes)
    const t1 = price - c[idx - 1]; // 1 candle back
    const th = price * 0.00003;

    if (direction === 'CALL') return t3 > th && t1 >= 0;
    else return t3 < -th && t1 <= 0;
  }

  return check(nq1m) && check(spx1m);
}

async function runTest() {
  console.log('Fetching NQ 1min data (4 weeks in chunks)...');
  const nq1m = await fetch1minMonth('NQ=F');
  console.log(`  NQ: ${nq1m?.timestamps.length || 0} candles`);

  console.log('Fetching SPX 1min data (4 weeks in chunks)...');
  const spx1m = await fetch1minMonth('^GSPC');
  console.log(`  SPX: ${spx1m?.timestamps.length || 0} candles`);

  if (!nq1m || !spx1m) { console.log('No convergence data'); return; }

  const noTrend = [];
  const withDailyTrend = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`Testing ${ticker}...`);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '1mo'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data5m || data5m.timestamps.length < 50) { console.log(' skip'); continue; }

    const days = groupByDay(data5m.timestamps);
    const dayKeys = Object.keys(days).sort();

    // Daily EMA10
    const dCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
    const dTimestamps = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    function getDayTrend(dayKey) {
      if (dCloses.length < 12) return 'NEUTRAL';
      const ts = new Date(dayKey + 'T12:00:00').getTime() / 1000;
      let idx = -1;
      for (let i = dTimestamps.length - 1; i >= 0; i--) {
        if (dTimestamps[i] <= ts + 86400) { idx = i; break; }
      }
      if (idx < 10 || !dEma10[idx]) return 'NEUTRAL';
      const price = dCloses[idx];
      const ema = dEma10[idx];
      const prevClose = idx > 0 ? dCloses[idx - 1] : price;
      const prev2Close = idx > 1 ? dCloses[idx - 2] : prevClose;
      if (price > ema && prevClose > prev2Close) return 'UP';
      if (price < ema && prevClose < prev2Close) return 'DOWN';
      return 'NEUTRAL';
    }

    let tickerTrades = 0;

    for (let di = 1; di < dayKeys.length; di++) {
      const dayKey = dayKeys[di];
      const prevDayKey = dayKeys[di - 1];
      const indices = days[dayKey];
      const prevIndices = days[prevDayKey];
      if (!prevIndices || indices.length < 15) continue;

      const levels = [];

      // PDH/PDL
      let pdh = -Infinity, pdl = Infinity;
      for (const pi of prevIndices) {
        const m = getMinutesET(data5m.timestamps[pi]);
        if (m >= 570 && m < 960) {
          if (data5m.highs[pi] != null && data5m.highs[pi] > pdh) pdh = data5m.highs[pi];
          if (data5m.lows[pi] != null && data5m.lows[pi] < pdl) pdl = data5m.lows[pi];
        }
      }
      if (pdh !== -Infinity) {
        levels.push({ name: 'PDH', price: +pdh.toFixed(2) });
        levels.push({ name: 'PDL', price: +pdl.toFixed(2) });
      }

      // PMH/PML
      let pmh = -Infinity, pml = Infinity, pmc = 0;
      for (const ci of indices) {
        const m = getMinutesET(data5m.timestamps[ci]);
        if (m >= 240 && m < 570) {
          if (data5m.highs[ci] != null && data5m.highs[ci] > pmh) pmh = data5m.highs[ci];
          if (data5m.lows[ci] != null && data5m.lows[ci] < pml) pml = data5m.lows[ci];
          pmc++;
        }
      }
      if (pmc >= 3 && pmh !== -Infinity) {
        levels.push({ name: 'PMH', price: +pmh.toFixed(2) });
        levels.push({ name: 'PML', price: +pml.toFixed(2) });
      }

      if (!levels.length) continue;

      const dayTrend = getDayTrend(dayKey);
      const touched = {};

      const regIndices = indices.filter(ci => {
        const m = getMinutesET(data5m.timestamps[ci]);
        return m >= 575 && m < 955;
      });

      let mhmlAdded = false;

      for (let ri = 1; ri < regIndices.length; ri++) {
        const ci = regIndices[ri];
        const prevCi = regIndices[ri - 1];
        const price = data5m.closes[ci];
        const h = data5m.highs[ci];
        const l = data5m.lows[ci];
        const o = data5m.opens[ci];
        const c = data5m.closes[ci];
        if (price == null || h == null || l == null || o == null) continue;

        const mins = getMinutesET(data5m.timestamps[ci]);

        if (mins >= 840 && !mhmlAdded) {
          let mh = -Infinity, ml = Infinity;
          for (const mi of indices) {
            const mm = getMinutesET(data5m.timestamps[mi]);
            if (mm >= 570 && mm < 720) {
              if (data5m.highs[mi] != null && data5m.highs[mi] > mh) mh = data5m.highs[mi];
              if (data5m.lows[mi] != null && data5m.lows[mi] < ml) ml = data5m.lows[mi];
            }
          }
          if (mh !== -Infinity) {
            levels.push({ name: 'MH', price: +mh.toFixed(2) });
            levels.push({ name: 'ML', price: +ml.toFixed(2) });
          }
          mhmlAdded = true;
        }

        const body = Math.abs(c - o);
        const wickUp = h - Math.max(c, o);
        const wickDn = Math.min(c, o) - l;
        const stopDist = getStop(price);
        const prevH = data5m.highs[prevCi];
        const prevL = data5m.lows[prevCi];

        for (const level of levels) {
          let dir = null, type = null;

          if (h > level.price && prevH != null && prevH <= level.price) { dir = 'CALL'; type = 'BRK'; }
          else if (l < level.price && prevL != null && prevL >= level.price) { dir = 'PUT'; type = 'BRK'; }
          else if (l <= level.price * 1.002 && c > level.price && wickDn > body * 2 && wickDn > 0.10) { dir = 'CALL'; type = 'REJ'; }
          else if (h >= level.price * 0.998 && c < level.price && wickUp > body * 2 && wickUp > 0.10) { dir = 'PUT'; type = 'REJ'; }

          if (!dir) continue;
          const tk = `${level.name}_${type}_${dir}`;
          if (touched[tk]) continue;

          // USE 1-MINUTE CONVERGENCE (matching real app)
          if (!checkConvergence1m(nq1m, spx1m, data5m.timestamps[ci], dir)) continue;

          touched[tk] = true;
          tickerTrades++;

          const endOfDay = regIndices[regIndices.length - 1];
          const res = simulateTrade(dir, price, stopDist, data5m, ci, endOfDay);

          const trade = {
            date: dayKey,
            time: new Date(data5m.timestamps[ci] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ticker, signal: dir, type, level: level.name,
            entry: +price.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type,
            result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : 'LOSS',
            dayTrend,
          };

          noTrend.push(trade);

          const dailyOk = !(dir === 'CALL' && dayTrend === 'DOWN') && !(dir === 'PUT' && dayTrend === 'UP');
          if (dailyOk) withDailyTrend.push(trade);
        }
      }
    }
    console.log(` ${tickerTrades} trades`);
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
    const nlr = trades.length ? ((1 - l / trades.length) * 100).toFixed(1) : 0;
    const pf = gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? '∞' : '0';

    console.log(`\n=== ${label} ===`);
    console.log(`Trades: ${trades.length} | Wins: ${w} | Losses: ${l} | BE: ${b}`);
    console.log(`WR: ${trades.length ? ((w/trades.length)*100).toFixed(1) : 0}% | NLR: ${nlr}% | PF: ${pf}`);
    console.log(`Total PnL: $${pnl.toFixed(2)} | Avg: $${trades.length ? (pnl/trades.length).toFixed(2) : 0}`);
    console.log(`Days: ${days} | Trades/day: ${days ? (trades.length/days).toFixed(1) : 0}`);
    return { trades: trades.length, w, l, b, pnl, pf, nlr, days };
  }

  console.log('\n' + '='.repeat(60));
  console.log('ULTRA SIMPLE BACKTEST v2 — 1-MINUTE CONVERGENCE');
  console.log('='.repeat(60));

  const s1 = stats(noTrend, 'SIN TENDENCIA (actual — convergencia 1min)');
  const s2 = stats(withDailyTrend, 'CON TENDENCIA DIARIA (EMA10)');

  const filtered = noTrend.filter(t => !withDailyTrend.includes(t));
  const fw = filtered.filter(t => t.result === 'WIN').length;
  const fl = filtered.filter(t => t.result === 'LOSS').length;
  const fpnl = filtered.reduce((s, t) => s + t.pnl, 0);

  console.log('\n--- TRADES ELIMINADOS POR FILTRO DIARIO ---');
  console.log(`Removidos: ${filtered.length} (${fw} wins, ${fl} losses) → PnL: $${fpnl.toFixed(2)}`);
  if (filtered.length <= 30) {
    filtered.forEach(t => console.log(`  ${t.date} ${t.time} ${t.ticker} ${t.signal} @${t.level} → ${t.result} $${t.pnl} [day:${t.dayTrend}]`));
  }

  // Show all trades for verification
  console.log('\n--- TODOS LOS TRADES (sin filtro) ---');
  const byDay = {};
  noTrend.forEach(t => { if (!byDay[t.date]) byDay[t.date] = []; byDay[t.date].push(t); });
  for (const [day, trades] of Object.entries(byDay).sort()) {
    const dw = trades.filter(t => t.result === 'WIN').length;
    const dl = trades.filter(t => t.result === 'LOSS').length;
    const dpnl = trades.reduce((s, t) => s + t.pnl, 0);
    console.log(`\n${day} — ${trades.length} trades (${dw}W ${dl}L) $${dpnl.toFixed(2)}`);
    trades.forEach(t => console.log(`  ${t.time} ${t.ticker.padEnd(5)} ${t.signal.padEnd(4)} ${t.type} @${t.level.padEnd(3)} $${t.entry} → ${t.result.padEnd(4)} $${t.pnl.toFixed(2)} [${t.exitType}]`));
  }
}

runTest().catch(console.error);
