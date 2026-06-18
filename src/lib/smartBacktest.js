// Smart Backtest — Backtests the smartEntry.js logic against historical data
// Uses Yahoo proxy for data, applies all live-learned rules

const YAHOO_PROXY = '/api/yahoo';

async function fetchChart(ticker, interval, range, period1 = null, period2 = null) {
  let url;
  if (period1 && period2) {
    url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&period1=${period1}&period2=${period2}`;
  } else {
    url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
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

function calcEMA(arr, period) {
  if (!arr || arr.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    ema.push(arr[i] != null ? arr[i] * k + ema[i - 1] * (1 - k) : ema[i - 1]);
  }
  return ema;
}

function calcVWAPProgressive(highs, lows, closes, volumes) {
  const vwaps = [];
  let num = 0, den = 0;
  for (let i = 0; i < closes.length; i++) {
    if (highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
      num += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
      den += volumes[i];
    }
    vwaps.push(den ? num / den : null);
  }
  return vwaps;
}

// Group 5min data by day
function groupByDay(timestamps) {
  const days = {};
  for (let i = 0; i < timestamps.length; i++) {
    const d = new Date(timestamps[i] * 1000);
    const key = d.toISOString().split('T')[0];
    if (!days[key]) days[key] = { start: i, end: i };
    else days[key].end = i;
  }
  return days;
}

// Check if candle is in trading hours (skip first 15 min and lunch)
function isGoodHour(ts) {
  const d = new Date(ts * 1000);
  const h = d.getUTCHours() - 4; // Approximate ET
  const m = d.getUTCMinutes();
  const totalMin = h * 60 + m;
  if (totalMin < 585) return false; // Before 9:45
  if (totalMin >= 720 && totalMin < 780) return false; // 12:00-1:00 lunch
  if (totalMin >= 955) return false; // Last 5 min
  return true;
}

export async function runSmartBacktest(ticker, range = '5d', startDate = null, endDate = null) {
  // Fetch data — use date range if provided
  const p1 = startDate ? Math.floor(new Date(startDate).getTime() / 1000) : null;
  const p2 = endDate ? Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000) : null;

  const [tickerData, spyData] = await Promise.all([
    fetchChart(ticker, '5m', range, p1, p2),
    fetchChart('SPY', '5m', range, p1, p2),
  ]);

  if (!tickerData || !spyData) throw new Error(`Sin datos para ${ticker}`);

  const { timestamps, opens, highs, lows, closes, volumes } = tickerData;
  const spyCloses = spyData.closes;
  const spyHighs = spyData.highs;
  const spyLows = spyData.lows;

  // Calculate indicators for full series
  const ema10 = calcEMA(closes, 10);
  const ema20 = calcEMA(closes, 20);
  const vwaps = calcVWAPProgressive(highs, lows, closes, volumes);

  // Fetch daily data for trend filter
  const dailyData = await fetchChart(ticker, '1d', '3mo', p1 ? p1 - 30*86400 : null, p2);
  const dailyCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
  const dailyTimestamps = dailyData ? dailyData.timestamps : [];

  function getDayTrend(dayKey) {
    // Find this day's position in daily data
    const dayTs = new Date(dayKey).getTime() / 1000;
    let idx = -1;
    for (let i = dailyTimestamps.length - 1; i >= 0; i--) {
      if (dailyTimestamps[i] <= dayTs + 86400) { idx = i; break; }
    }
    if (idx < 10) return 'UNKNOWN';
    const price = dailyCloses[idx];
    const ago10 = dailyCloses[idx - 10];
    const ago5 = dailyCloses[Math.max(0, idx - 5)];
    const t10 = ((price - ago10) / ago10) * 100;
    const t5 = ((price - ago5) / ago5) * 100;
    if (t10 > 0.5 && t5 > 0) return 'UP';
    if (t10 < -0.5 && t5 < 0) return 'DOWN';
    return 'NEUTRAL';
  }

  // Group by day
  const days = groupByDay(timestamps);
  const dayKeys = Object.keys(days).sort();

  const trades = [];
  const warmup = 20;

  for (const dayKey of dayKeys) {
    const { start, end } = days[dayKey];
    const dayLen = end - start + 1;
    if (dayLen < 30) continue;

    // Daily trend for this day
    const dayTrend = getDayTrend(dayKey);

    // Reset VWAP per day
    let dayVwapNum = 0, dayVwapDen = 0;
    const dayVwaps = [];
    for (let i = start; i <= end; i++) {
      if (highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
        dayVwapNum += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
        dayVwapDen += volumes[i];
      }
      dayVwaps.push(dayVwapDen ? dayVwapNum / dayVwapDen : null);
    }

    // SPY day open for convergence
    const spyOpen = spyCloses[start];
    let traded = false;

    for (let i = start + warmup; i <= end - 5; i++) {
      if (traded) break;
      if (closes[i] == null || ema10[i] == null || ema20[i] == null) continue;
      if (!isGoodHour(timestamps[i])) continue;

      const price = closes[i];
      const e10 = ema10[i];
      const e20 = ema20[i];
      const e10slope = ema10[i] - ema10[Math.max(0, i - 3)];
      const e10slope6 = ema10[i] - ema10[Math.max(0, i - 6)];
      const vwap = dayVwaps[i - start];

      // Volume check
      const volSlice = volumes.slice(Math.max(0, i - 20), i + 1).filter(v => v != null && v > 0);
      const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1;
      const currentVol = volumes[i] || 0;
      const highVol = currentVol > avgVol * 1.5;

      // SPY convergence
      const spyNow = spyCloses[Math.min(i, spyCloses.length - 1)];
      const spyPct = spyOpen ? ((spyNow - spyOpen) / spyOpen) * 100 : 0;
      const spy15ago = spyCloses[Math.max(0, Math.min(i - 3, spyCloses.length - 1))];
      const spyTrend = spyNow - spy15ago;

      // Previous candles
      const prev1 = closes[i - 1];
      const prev2 = closes[i - 2];
      const prevOpen1 = opens[i - 1];

      // Chop detection: count touches of range
      const rangeH = Math.max(...highs.slice(Math.max(start, i - 30), i + 1).filter(v => v != null));
      const rangeL = Math.min(...lows.slice(Math.max(start, i - 30), i + 1).filter(v => v != null));
      const rangePct = ((rangeH - rangeL) / price) * 100;
      let highTouches = 0, lowTouches = 0;
      for (let j = Math.max(start, i - 30); j <= i; j++) {
        if (highs[j] >= rangeH * 0.998) highTouches++;
        if (lows[j] <= rangeL * 1.002) lowTouches++;
      }
      const isChop = highTouches >= 3 && lowTouches >= 3 && rangePct < 1.5;
      if (isChop) continue;

      // Liquidity sweep detection
      const sweepLow = lows[i] < rangeL * 1.001 && closes[i] > rangeL && (closes[i] - lows[i]) > Math.abs(closes[i] - opens[i]) * 1.5;
      const sweepHigh = highs[i] > rangeH * 0.999 && closes[i] < rangeH && (highs[i] - closes[i]) > Math.abs(closes[i] - opens[i]) * 1.5;

      // VWAP reclaim
      const wasBelowVwap = vwap && closes[i - 3] < vwap && closes[i - 2] < vwap;
      const nowAboveVwap = vwap && price > vwap;
      const vwapReclaim = wasBelowVwap && nowAboveVwap;

      // === SCORE CALL ===
      let callScore = 0;
      const callReasons = [];

      if (price > e10 && e10slope > 0.05) { callScore += 2; callReasons.push('EMA10↑'); }
      if (e10 > e20) { callScore += 1; callReasons.push('EMA10>20'); }
      if (vwap && price > vwap) { callScore += 2; callReasons.push('VWAP↑'); }
      if (vwapReclaim) { callScore += 3; callReasons.push('VWAP_reclaim'); }
      if (spyPct > 0.1 && spyTrend > 0) { callScore += 2; callReasons.push('SPY↑'); }
      if (highVol) { callScore += 1; callReasons.push('Vol↑'); }
      if (sweepLow) { callScore += 2; callReasons.push('Sweep↓'); }
      // Pullback bounce
      if (prev1 < prevOpen1 && closes[i] > opens[i]) { callScore += 1; callReasons.push('Bounce'); }

      // === SCORE PUT ===
      let putScore = 0;
      const putReasons = [];

      if (price < e10 && e10slope < -0.05) { putScore += 2; putReasons.push('EMA10↓'); }
      if (e10 < e20) { putScore += 1; putReasons.push('EMA10<20'); }
      if (vwap && price < vwap) { putScore += 2; putReasons.push('VWAP↓'); }
      if (spyPct < -0.1 && spyTrend < 0) { putScore += 2; putReasons.push('SPY↓'); }
      if (highVol) { putScore += 1; putReasons.push('Vol↑'); }
      if (sweepHigh) { putScore += 2; putReasons.push('Sweep↑'); }
      if (prev1 > prevOpen1 && closes[i] < opens[i]) { putScore += 1; putReasons.push('Rejection'); }

      // Pick direction (min score 5)
      let direction = null, score = 0, reasons = [];
      if (callScore >= 5 && callScore > putScore) {
        direction = 'CALL'; score = callScore; reasons = callReasons;
      } else if (putScore >= 5 && putScore > callScore) {
        direction = 'PUT'; score = putScore; reasons = putReasons;
      }

      if (!direction) continue;

      // Daily trend filter — no counter-trend trades
      if (direction === 'CALL' && dayTrend === 'DOWN') continue;
      if (direction === 'PUT' && dayTrend === 'UP') continue;

      // SPY at extreme check
      const spyDayLow = Math.min(...spyLows.slice(start, i + 1).filter(v => v != null));
      const spyDayHigh = Math.max(...spyHighs.slice(start, i + 1).filter(v => v != null));
      if (direction === 'CALL' && (spyNow - spyDayLow) < 0.50) continue;
      if (direction === 'PUT' && (spyDayHigh - spyNow) < 0.50) continue;

      // Adaptive stop/target based on price
      // <$250: $1 stop, $3 target | $250-400: $1.50/$4.50 | >$400: $2/$6
      let stopDist;
      if (price < 250) stopDist = 1.0;
      else if (price < 400) stopDist = 1.5;
      else if (price < 550) stopDist = 2.0;
      else stopDist = 2.5;
      const targetDist = stopDist * 3;
      const beDist = stopDist;

      let stop, target;
      if (direction === 'CALL') {
        stop = price - stopDist;
        target = price + targetDist;
      } else {
        stop = price + stopDist;
        target = price - targetDist;
      }

      // Simulate trade with BE at +stopDist
      let result = 'EOD';
      let exitPrice = closes[end] || price;
      let exitIdx = end;
      let maxFavorable = 0;
      let beTriggered = false;
      let currentStop = stop;

      for (let j = i + 1; j <= end; j++) {
        if (highs[j] == null || lows[j] == null) continue;

        if (direction === 'CALL') {
          maxFavorable = Math.max(maxFavorable, highs[j] - price);
          if (highs[j] - price >= beDist && !beTriggered) { currentStop = price; beTriggered = true; }
          if (lows[j] <= currentStop) {
            result = beTriggered && currentStop === price ? 'BE' : 'STOP';
            exitPrice = currentStop; exitIdx = j; break;
          }
          if (highs[j] >= target) { result = 'TARGET'; exitPrice = target; exitIdx = j; break; }
        } else {
          maxFavorable = Math.max(maxFavorable, price - lows[j]);
          if (price - lows[j] >= beDist && !beTriggered) { currentStop = price; beTriggered = true; }
          if (highs[j] >= currentStop) {
            result = beTriggered && currentStop === price ? 'BE' : 'STOP';
            exitPrice = currentStop; exitIdx = j; break;
          }
          if (lows[j] <= target) { result = 'TARGET'; exitPrice = target; exitIdx = j; break; }
        }
      }

      const pnl = direction === 'CALL' ? exitPrice - price : price - exitPrice;
      const pnlPct = (pnl / price) * 100;
      const risk = Math.abs(price - stop);

      // Setup grade
      let setup;
      if (score >= 8) setup = 'A+';
      else if (score >= 6) setup = 'A';
      else if (score >= 5) setup = 'B';
      else setup = 'C';

      const entryTime = new Date(timestamps[i] * 1000);
      const exitTime = new Date(timestamps[exitIdx] * 1000);

      trades.push({
        date: entryTime.toLocaleDateString(),
        time: entryTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        exitTime: exitTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        signal: direction,
        entry: +price.toFixed(2),
        sl: +stop.toFixed(2),
        tp: +target_20.toFixed(2),
        exitPrice: +exitPrice.toFixed(2),
        pnl: +pnl.toFixed(2),
        pnlPct: +pnlPct.toFixed(2),
        result: pnl > 0 ? 'WIN' : 'LOSS',
        exitType: result,
        score,
        setup,
        reasons: reasons.join(', '),
        maxFavorable: +maxFavorable.toFixed(2),
        risk: +risk.toFixed(2),
        rr: risk > 0 ? +(pnl / risk).toFixed(2) : 0,
        spyPct: +spyPct.toFixed(2),
        vwapReclaim,
      });

      traded = true; // 1 trade per day max
    }
  }

  // Stats
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length) : 0;

  return {
    ticker,
    range,
    trades,
    stats: {
      total: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      totalPnl: +totalPnl.toFixed(2),
      avgPnl: trades.length ? +(totalPnl / trades.length).toFixed(2) : 0,
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      profitFactor: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0,
      bestTrade: trades.length ? Math.max(...trades.map(t => t.pnlPct)) : 0,
      worstTrade: trades.length ? Math.min(...trades.map(t => t.pnlPct)) : 0,
    },
  };
}

// Run backtest for multiple tickers
export async function runMultiBacktest(tickers = ['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL'], range = '5d', startDate = null, endDate = null) {
  const results = await Promise.all(tickers.map(t => runSmartBacktest(t, range, startDate, endDate).catch(e => ({ ticker: t, error: e.message, trades: [], stats: { total: 0 } }))));

  const allTrades = results.flatMap(r => r.trades || []);
  const wins = allTrades.filter(t => t.result === 'WIN');
  const losses = allTrades.filter(t => t.result === 'LOSS');
  const totalPnl = allTrades.reduce((s, t) => s + t.pnlPct, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length) : 0;

  return {
    tickers,
    range,
    results,
    combined: {
      total: allTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: allTrades.length ? +((wins.length / allTrades.length) * 100).toFixed(1) : 0,
      totalPnl: +totalPnl.toFixed(2),
      avgPnl: allTrades.length ? +(totalPnl / allTrades.length).toFixed(2) : 0,
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      profitFactor: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0,
    },
    allTrades: allTrades.sort((a, b) => new Date(a.date) - new Date(b.date)),
  };
}
