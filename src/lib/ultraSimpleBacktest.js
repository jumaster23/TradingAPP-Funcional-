// Ultra Simple Backtest — Tests level + convergence strategy with/without trend filter
// Compares: current (no trend) vs with daily trend filter

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range, period1 = null, period2 = null) {
  let url;
  if (period1 && period2) {
    url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&period1=${period1}&period2=${period2}&includePrePost=true`;
  } else {
    url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  }
  const res = await fetch(url);
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

// Group candles by day using ET timezone
function groupByDay(timestamps) {
  const days = {};
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const key = et.toISOString().split('T')[0];
    if (!days[key]) days[key] = { indices: [], start: i, end: i };
    days[key].indices.push(i);
    days[key].end = i;
  }
  return days;
}

function getMinutesET(ts) {
  const d = new Date(ts * 1000);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

// Simulate trade and return result
function simulateTrade(direction, entryPrice, stopDist, candles, startIdx, endIdx) {
  const target = direction === 'CALL' ? entryPrice + stopDist * 3 : entryPrice - stopDist * 3;
  const beLevel = direction === 'CALL' ? entryPrice + stopDist : entryPrice - stopDist;
  let stop = direction === 'CALL' ? entryPrice - stopDist : entryPrice + stopDist;
  let beTriggered = false;
  let maxFav = 0;

  for (let j = startIdx + 1; j <= endIdx; j++) {
    const h = candles.highs[j];
    const l = candles.lows[j];
    if (h == null || l == null) continue;

    if (direction === 'CALL') {
      maxFav = Math.max(maxFav, h - entryPrice);
      if (h >= beLevel && !beTriggered) { stop = entryPrice; beTriggered = true; }
      if (l <= stop) return { exitPrice: stop, exitType: beTriggered ? 'BE' : 'STOP', pnl: stop - entryPrice, maxFav, exitIdx: j };
      if (h >= target) return { exitPrice: target, exitType: 'TARGET', pnl: target - entryPrice, maxFav, exitIdx: j };
    } else {
      maxFav = Math.max(maxFav, entryPrice - l);
      if (entryPrice - l >= stopDist && !beTriggered) { stop = entryPrice; beTriggered = true; }
      if (h >= stop) return { exitPrice: stop, exitType: beTriggered ? 'BE' : 'STOP', pnl: entryPrice - stop, maxFav, exitIdx: j };
      if (l <= target) return { exitPrice: target, exitType: 'TARGET', pnl: entryPrice - target, maxFav, exitIdx: j };
    }
  }

  // EOD
  const exitPrice = candles.closes[endIdx] || entryPrice;
  const pnl = direction === 'CALL' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return { exitPrice, exitType: 'EOD', pnl, maxFav, exitIdx: endIdx };
}

// Check if NQ and SPX converge at a specific candle index
function checkConvergenceAt(nqData, spxData, idx, direction) {
  if (!nqData || !spxData) return false;

  const nqC = nqData.closes;
  const spxC = spxData.closes;

  // Find closest NQ/SPX candle to this timestamp
  const nqIdx = Math.min(idx, nqC.length - 1);
  const spxIdx = Math.min(idx, spxC.length - 1);

  if (nqIdx < 3 || spxIdx < 3) return false;
  if (nqC[nqIdx] == null || spxC[spxIdx] == null) return false;

  const nqPrice = nqC[nqIdx];
  const nqT3 = nqPrice - nqC[nqIdx - 3];
  const nqT1 = nqPrice - nqC[nqIdx - 1];
  const nqTh = nqPrice * 0.00003;

  const spxPrice = spxC[spxIdx];
  const spxT3 = spxPrice - spxC[spxIdx - 3];
  const spxT1 = spxPrice - spxC[spxIdx - 1];
  const spxTh = spxPrice * 0.00003;

  if (direction === 'CALL') {
    return (nqT3 > nqTh && nqT1 >= 0) && (spxT3 > spxTh && spxT1 >= 0);
  } else {
    return (nqT3 < -nqTh && nqT1 <= 0) && (spxT3 < -spxTh && spxT1 <= 0);
  }
}

// Main backtest — runs BOTH strategies (with/without trend)
export async function runUltraSimpleBacktest(tickers = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'], range = '1mo', startDate = null, endDate = null) {
  const p1 = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : null;
  const p2 = endDate ? Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000) : null;

  // Fetch NQ and SPX for convergence
  const [nqData, spxData] = await Promise.all([
    fetchChart('NQ=F', '5m', range, p1, p2),
    fetchChart('^GSPC', '5m', range, p1, p2),
  ]);

  const allResults = { noTrend: [], withTrend: [] };

  for (const ticker of tickers) {
    try {
      const data5m = await fetchChart(ticker, '5m', range, p1, p2);
      const daily = await fetchChart(ticker, '1d', '3mo', p1 ? p1 - 30 * 86400 : null, p2);

      if (!data5m || data5m.timestamps.length < 50) continue;

      const days = groupByDay(data5m.timestamps);
      const dayKeys = Object.keys(days).sort();

      // Calculate daily EMA10 for trend filter
      const dailyCloses = daily ? daily.closes.filter(v => v != null) : [];
      const dailyTimestamps = daily ? daily.timestamps : [];
      const dailyEma10 = calcEMA(dailyCloses, 10);

      function getDayTrend(dayKey) {
        if (!daily || dailyCloses.length < 12) return 'NEUTRAL';
        const dayTs = new Date(dayKey).getTime() / 1000;
        let idx = -1;
        for (let i = dailyTimestamps.length - 1; i >= 0; i--) {
          if (dailyTimestamps[i] <= dayTs + 86400) { idx = i; break; }
        }
        if (idx < 10) return 'NEUTRAL';
        const price = dailyCloses[idx];
        const ema = dailyEma10[idx];
        const prevClose = dailyCloses[idx - 1];

        // Trend = price vs EMA10 + previous day direction
        if (price > ema && prevClose > dailyCloses[idx - 2]) return 'UP';
        if (price < ema && prevClose < dailyCloses[idx - 2]) return 'DOWN';
        return 'NEUTRAL';
      }

      for (let dayIdx = 1; dayIdx < dayKeys.length; dayIdx++) {
        const dayKey = dayKeys[dayIdx];
        const prevDayKey = dayKeys[dayIdx - 1];
        const { indices, start, end } = days[dayKey];
        const prevDay = days[prevDayKey];
        if (!prevDay || indices.length < 20) continue;

        // === CALCULATE LEVELS ===
        const levels = [];

        // PDH / PDL from previous day
        let pdh = -Infinity, pdl = Infinity;
        for (const pi of prevDay.indices) {
          const mins = getMinutesET(data5m.timestamps[pi]);
          if (mins >= 570 && mins < 960) { // Regular hours only
            if (data5m.highs[pi] != null && data5m.highs[pi] > pdh) pdh = data5m.highs[pi];
            if (data5m.lows[pi] != null && data5m.lows[pi] < pdl) pdl = data5m.lows[pi];
          }
        }
        if (pdh !== -Infinity) {
          levels.push({ name: 'PDH', price: +pdh.toFixed(2), type: 'resistance' });
          levels.push({ name: 'PDL', price: +pdl.toFixed(2), type: 'support' });
        }

        // PMH / PML from today's premarket (4:00-9:30)
        let pmh = -Infinity, pml = Infinity, pmCount = 0;
        for (const ci of indices) {
          const mins = getMinutesET(data5m.timestamps[ci]);
          if (mins >= 240 && mins < 570) {
            if (data5m.highs[ci] != null && data5m.highs[ci] > pmh) pmh = data5m.highs[ci];
            if (data5m.lows[ci] != null && data5m.lows[ci] < pml) pml = data5m.lows[ci];
            pmCount++;
          }
        }
        if (pmCount >= 3 && pmh !== -Infinity) {
          levels.push({ name: 'PMH', price: +pmh.toFixed(2), type: 'resistance' });
          levels.push({ name: 'PML', price: +pml.toFixed(2), type: 'support' });
        }

        if (levels.length === 0) continue;

        // Day trend
        const dayTrend = getDayTrend(dayKey);

        // Intraday EMA10 for intraday trend
        const dayCloses = indices.filter(ci => getMinutesET(data5m.timestamps[ci]) >= 570).map(ci => data5m.closes[ci]).filter(v => v != null);
        const intradayEma10 = calcEMA(dayCloses, 10);

        // Track first touches per level
        const touched = {};

        // Walk through regular hours candles
        const regularIndices = indices.filter(ci => {
          const mins = getMinutesET(data5m.timestamps[ci]);
          return mins >= 575 && mins < 955; // 9:35 - 15:55
        });

        for (let ri = 1; ri < regularIndices.length; ri++) {
          const ci = regularIndices[ri];
          const prevCi = regularIndices[ri - 1];
          const price = data5m.closes[ci];
          const h = data5m.highs[ci];
          const l = data5m.lows[ci];
          const o = data5m.opens[ci];
          const c = data5m.closes[ci];
          const prevH = data5m.highs[prevCi];
          const prevL = data5m.lows[prevCi];
          if (price == null || h == null || l == null) continue;

          const body = Math.abs(c - o);
          const wickUp = h - Math.max(c, o);
          const wickDn = Math.min(c, o) - l;
          const stopDist = getStop(price);

          // Check MH/ML after 14:00
          const mins = getMinutesET(data5m.timestamps[ci]);
          if (mins >= 840 && levels.every(lv => lv.name !== 'MH')) {
            // Calculate morning high/low (9:30-12:00)
            let mh = -Infinity, ml = Infinity;
            for (const mi of indices) {
              const mm = getMinutesET(data5m.timestamps[mi]);
              if (mm >= 570 && mm < 720) {
                if (data5m.highs[mi] != null && data5m.highs[mi] > mh) mh = data5m.highs[mi];
                if (data5m.lows[mi] != null && data5m.lows[mi] < ml) ml = data5m.lows[mi];
              }
            }
            if (mh !== -Infinity) {
              levels.push({ name: 'MH', price: +mh.toFixed(2), type: 'resistance' });
              levels.push({ name: 'ML', price: +ml.toFixed(2), type: 'support' });
            }
          }

          // Intraday trend at this point
          const emaIdx = ri - 1;
          const intradayTrend = intradayEma10.length > emaIdx && emaIdx >= 2
            ? (dayCloses[emaIdx] > intradayEma10[emaIdx] ? 'UP' : dayCloses[emaIdx] < intradayEma10[emaIdx] ? 'DOWN' : 'NEUTRAL')
            : 'NEUTRAL';

          for (const level of levels) {
            let direction = null;
            let type = null;

            // BREAKOUT UP
            if (h > level.price && prevH <= level.price) {
              direction = 'CALL'; type = 'BREAKOUT';
            }
            // BREAKOUT DOWN
            else if (l < level.price && prevL >= level.price) {
              direction = 'PUT'; type = 'BREAKOUT';
            }
            // REJECTION SUPPORT → CALL
            else if (l <= level.price * 1.002 && c > level.price && wickDn > body * 2 && wickDn > 0.10) {
              direction = 'CALL'; type = 'REJECTION';
            }
            // REJECTION RESISTANCE → PUT
            else if (h >= level.price * 0.998 && c < level.price && wickUp > body * 2 && wickUp > 0.10) {
              direction = 'PUT'; type = 'REJECTION';
            }

            if (!direction) continue;

            // First touch only
            const touchKey = `${level.name}_${type}_${direction}`;
            if (touched[touchKey]) continue;

            // Check convergence
            if (!checkConvergenceAt(nqData, spxData, ci, direction)) continue;

            touched[touchKey] = true;

            // Simulate trade
            const endOfDay = regularIndices[regularIndices.length - 1];
            const result = simulateTrade(direction, price, stopDist, data5m, ci, endOfDay);
            const time = new Date(data5m.timestamps[ci] * 1000);

            const trade = {
              date: dayKey,
              time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              ticker,
              signal: direction,
              type,
              level: level.name,
              levelPrice: level.price,
              entry: +price.toFixed(2),
              sl: +(direction === 'CALL' ? price - stopDist : price + stopDist).toFixed(2),
              tp: +(direction === 'CALL' ? price + stopDist * 3 : price - stopDist * 3).toFixed(2),
              exitPrice: +result.exitPrice.toFixed(2),
              pnl: +result.pnl.toFixed(2),
              exitType: result.exitType,
              result: result.pnl > 0 ? 'WIN' : result.pnl === 0 ? 'BE' : 'LOSS',
              maxFav: +result.maxFav.toFixed(2),
              dayTrend,
              intradayTrend,
            };

            // NO TREND — always add
            allResults.noTrend.push({ ...trade });

            // WITH TREND — skip counter-trend trades
            const trendOk = (
              (direction === 'CALL' && dayTrend !== 'DOWN' && intradayTrend !== 'DOWN') ||
              (direction === 'PUT' && dayTrend !== 'UP' && intradayTrend !== 'UP')
            );
            if (trendOk) {
              allResults.withTrend.push({ ...trade });
            }
          }
        }
      }
    } catch (e) {
      console.error(`Backtest error ${ticker}:`, e);
    }
  }

  // Calculate stats for both
  function calcStats(trades) {
    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const bes = trades.filter(t => t.result === 'BE');
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const nlr = trades.length ? +((1 - losses.length / trades.length) * 100).toFixed(1) : 0;
    const tradesPerDay = {};
    trades.forEach(t => { tradesPerDay[t.date] = (tradesPerDay[t.date] || 0) + 1; });
    const days = Object.keys(tradesPerDay).length;

    return {
      total: trades.length,
      wins: wins.length,
      losses: losses.length,
      bes: bes.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      nlr,
      totalPnl: +totalPnl.toFixed(2),
      avgPnl: trades.length ? +(totalPnl / trades.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 999 : 0,
      days,
      tradesPerDay: days ? +(trades.length / days).toFixed(1) : 0,
    };
  }

  // Filtered trades — trades that trend filter REMOVED
  const filtered = allResults.noTrend.filter(t => !allResults.withTrend.some(wt => wt.date === t.date && wt.ticker === t.ticker && wt.level === t.level && wt.signal === t.signal));

  return {
    noTrend: { trades: allResults.noTrend, stats: calcStats(allResults.noTrend) },
    withTrend: { trades: allResults.withTrend, stats: calcStats(allResults.withTrend) },
    filtered: { trades: filtered, stats: calcStats(filtered) },
    comparison: {
      tradesRemoved: allResults.noTrend.length - allResults.withTrend.length,
      winsRemoved: filtered.filter(t => t.result === 'WIN').length,
      lossesRemoved: filtered.filter(t => t.result === 'LOSS').length,
      pnlDiff: +(calcStats(allResults.withTrend).totalPnl - calcStats(allResults.noTrend).totalPnl).toFixed(2),
    },
  };
}
