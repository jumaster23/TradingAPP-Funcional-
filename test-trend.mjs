// Quick test: Ultra Simple with vs without daily trend filter
// Run: node test-trend.mjs

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
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

function checkConvergenceAt(nqData, spxData, ts, direction) {
  if (!nqData || !spxData) return false;

  // Find closest index by timestamp
  function findIdx(data, targetTs) {
    let best = 0;
    for (let i = 0; i < data.timestamps.length; i++) {
      if (Math.abs(data.timestamps[i] - targetTs) < Math.abs(data.timestamps[best] - targetTs)) best = i;
    }
    return best;
  }

  const nqIdx = findIdx(nqData, ts);
  const spxIdx = findIdx(spxData, ts);
  if (nqIdx < 3 || spxIdx < 3) return false;

  const nqC = nqData.closes, spxC = spxData.closes;
  if (nqC[nqIdx] == null || spxC[spxIdx] == null) return false;

  const nqP = nqC[nqIdx], nqT3 = nqP - nqC[nqIdx-3], nqT1 = nqP - nqC[nqIdx-1];
  const spxP = spxC[spxIdx], spxT3 = spxP - spxC[spxIdx-3], spxT1 = spxP - spxC[spxIdx-1];

  if (direction === 'CALL') {
    return nqT3 > nqP * 0.00003 && nqT1 >= 0 && spxT3 > spxP * 0.00003 && spxT1 >= 0;
  } else {
    return nqT3 < -nqP * 0.00003 && nqT1 <= 0 && spxT3 < -spxP * 0.00003 && spxT1 <= 0;
  }
}

async function runTest() {
  console.log('Fetching NQ + SPX data...');
  const [nqData, spxData] = await Promise.all([
    fetchChart('NQ=F', '5m', '1mo'),
    fetchChart('^GSPC', '5m', '1mo'),
  ]);
  if (!nqData || !spxData) { console.log('No NQ/SPX data'); return; }

  const noTrend = [];
  const withDailyTrend = [];
  const withIntradayTrend = [];
  const withBothTrend = [];

  for (const ticker of TICKERS) {
    console.log(`Testing ${ticker}...`);
    const [data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '1mo'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data5m || data5m.timestamps.length < 50) { console.log(`  Skip ${ticker} — no data`); continue; }

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

    for (let di = 1; di < dayKeys.length; di++) {
      const dayKey = dayKeys[di];
      const prevDayKey = dayKeys[di - 1];
      const indices = days[dayKey];
      const prevIndices = days[prevDayKey];
      if (!prevIndices || indices.length < 15) continue;

      // PDH/PDL
      const levels = [];
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

      // Regular hours
      const regIndices = indices.filter(ci => {
        const m = getMinutesET(data5m.timestamps[ci]);
        return m >= 575 && m < 955;
      });

      // Intraday EMA10
      const regCloses = regIndices.map(ci => data5m.closes[ci]).filter(v => v != null);
      const iEma10 = calcEMA(regCloses, 10);

      // Add MH/ML after 14:00
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

        // Add MH/ML at 14:00
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

        // Intraday trend
        const intTrend = iEma10.length > ri && ri >= 2
          ? (regCloses[ri] > iEma10[ri] ? 'UP' : regCloses[ri] < iEma10[ri] ? 'DOWN' : 'NEUTRAL')
          : 'NEUTRAL';

        for (const level of levels) {
          let dir = null, type = null;

          if (h > level.price && prevH != null && prevH <= level.price) { dir = 'CALL'; type = 'BRK'; }
          else if (l < level.price && prevL != null && prevL >= level.price) { dir = 'PUT'; type = 'BRK'; }
          else if (l <= level.price * 1.002 && c > level.price && wickDn > body * 2 && wickDn > 0.10) { dir = 'CALL'; type = 'REJ'; }
          else if (h >= level.price * 0.998 && c < level.price && wickUp > body * 2 && wickUp > 0.10) { dir = 'PUT'; type = 'REJ'; }

          if (!dir) continue;
          const tk = `${level.name}_${type}_${dir}`;
          if (touched[tk]) continue;
          if (!checkConvergenceAt(nqData, spxData, data5m.timestamps[ci], dir)) continue;
          touched[tk] = true;

          const endOfDay = regIndices[regIndices.length - 1];
          const res = simulateTrade(dir, price, stopDist, data5m, ci, endOfDay);

          const trade = {
            date: dayKey, ticker, signal: dir, type, level: level.name,
            entry: +price.toFixed(2), pnl: +res.pnl.toFixed(2), exitType: res.type,
            result: res.pnl > 0 ? 'WIN' : res.pnl === 0 ? 'BE' : 'LOSS',
            dayTrend, intTrend,
          };

          // Always add to noTrend
          noTrend.push(trade);

          // Daily trend filter
          const dailyOk = !(dir === 'CALL' && dayTrend === 'DOWN') && !(dir === 'PUT' && dayTrend === 'UP');
          if (dailyOk) withDailyTrend.push(trade);

          // Intraday trend filter
          const intOk = !(dir === 'CALL' && intTrend === 'DOWN') && !(dir === 'PUT' && intTrend === 'UP');
          if (intOk) withIntradayTrend.push(trade);

          // Both
          if (dailyOk && intOk) withBothTrend.push(trade);
        }
      }
    }
  }

  // Stats
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
  console.log('ULTRA SIMPLE BACKTEST — TREND FILTER COMPARISON');
  console.log('Period: ~1 month | Tickers:', TICKERS.join(', '));
  console.log('='.repeat(60));

  const s1 = stats(noTrend, 'SIN TENDENCIA (actual)');
  const s2 = stats(withDailyTrend, 'CON TENDENCIA DIARIA (EMA10 daily)');
  const s3 = stats(withIntradayTrend, 'CON TENDENCIA INTRADAY (EMA10 5min)');
  const s4 = stats(withBothTrend, 'CON AMBAS TENDENCIAS (daily + intraday)');

  // What was filtered out
  console.log('\n' + '='.repeat(60));
  console.log('QUÉ TRADES ELIMINÓ CADA FILTRO:');
  console.log('='.repeat(60));

  const dailyFiltered = noTrend.filter(t => !withDailyTrend.includes(t));
  const intFiltered = noTrend.filter(t => !withIntradayTrend.includes(t));
  const bothFiltered = noTrend.filter(t => !withBothTrend.includes(t));

  function filterStats(filtered, label) {
    const w = filtered.filter(t => t.result === 'WIN').length;
    const l = filtered.filter(t => t.result === 'LOSS').length;
    const pnl = filtered.reduce((s, t) => s + t.pnl, 0);
    console.log(`\n${label}: eliminó ${filtered.length} trades (${w} wins, ${l} losses) → PnL removido: $${pnl.toFixed(2)}`);
    if (filtered.length <= 20) {
      filtered.forEach(t => console.log(`  ${t.date} ${t.ticker} ${t.signal} @${t.level} $${t.entry} → ${t.result} $${t.pnl} [day:${t.dayTrend} int:${t.intTrend}]`));
    }
  }

  filterStats(dailyFiltered, 'DAILY TREND');
  filterStats(intFiltered, 'INTRADAY TREND');
  filterStats(bothFiltered, 'AMBAS');

  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN');
  console.log('='.repeat(60));
  console.log(`Sin filtro:       ${s1.trades} trades, PF ${s1.pf}, $${s1.pnl.toFixed(2)}, NLR ${s1.nlr}%`);
  console.log(`+ Daily trend:    ${s2.trades} trades, PF ${s2.pf}, $${s2.pnl.toFixed(2)}, NLR ${s2.nlr}%`);
  console.log(`+ Intraday trend: ${s3.trades} trades, PF ${s3.pf}, $${s3.pnl.toFixed(2)}, NLR ${s3.nlr}%`);
  console.log(`+ Ambas:          ${s4.trades} trades, PF ${s4.pf}, $${s4.pnl.toFixed(2)}, NLR ${s4.nlr}%`);
}

runTest().catch(console.error);
