// Replicate smartBacktest logic for TODAY only
// This is the /live strategy: EMA10/20, VWAP, chop, sweeps, SPY convergence, scoring

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

function calcEMA(arr, period) {
  if (!arr || arr.length < period) return [];
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

function groupByDay(ts) {
  const d = {}; for (let i = 0; i < ts.length; i++) { const k = getDayKeyET(ts[i]); if (!d[k]) d[k] = { start: i, end: i }; else d[k].end = i; } return d;
}

function isGoodHour(ts) {
  const m = getMinutesET(ts);
  if (m < 585) return false;  // Before 9:45
  if (m >= 720 && m < 780) return false; // 12-1pm lunch
  if (m >= 955) return false; // Last 5 min
  return true;
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n/LIVE STRATEGY — Trades de hoy (${today})`);
  console.log('Logica: EMA10/20, VWAP, chop, sweep, SPY convergence, scoring min 5pts');
  console.log('='.repeat(80));

  const allTrades = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);

    const [tickerData, spyData, dailyData] = await Promise.all([
      fetchChart(ticker, '5m', '2d'),
      fetchChart('SPY', '5m', '2d'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!tickerData || !spyData) { console.log('skip'); continue; }

    const { timestamps, opens, highs, lows, closes, volumes } = tickerData;
    const spyCloses = spyData.closes, spyHighs = spyData.highs, spyLows = spyData.lows;

    const ema10 = calcEMA(closes, 10);
    const ema20 = calcEMA(closes, 20);

    // Daily trend
    const dCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
    const dTs = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    let dayTrend = 'UNKNOWN';
    if (dCloses.length >= 12) {
      const idx = dCloses.length - 1;
      const t10 = ((dCloses[idx] - dCloses[idx-10]) / dCloses[idx-10]) * 100;
      const t5 = ((dCloses[idx] - dCloses[idx-5]) / dCloses[idx-5]) * 100;
      if (t10 > 0.5 && t5 > 0) dayTrend = 'UP';
      else if (t10 < -0.5 && t5 < 0) dayTrend = 'DOWN';
      else dayTrend = 'NEUTRAL';
    }

    // Find today's candles
    const days = groupByDay(timestamps);
    const todayData = days[today];
    if (!todayData) { console.log('no data today'); continue; }
    const { start, end } = todayData;
    const dayLen = end - start + 1;
    if (dayLen < 20) { console.log('not enough candles'); continue; }

    // VWAP for today
    let vwapNum = 0, vwapDen = 0;
    const dayVwaps = [];
    for (let i = start; i <= end; i++) {
      if (highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
        vwapNum += ((highs[i] + lows[i] + closes[i]) / 3) * volumes[i];
        vwapDen += volumes[i];
      }
      dayVwaps.push(vwapDen ? vwapNum / vwapDen : null);
    }

    const spyOpen = spyCloses[start];
    let traded = false;
    const warmup = 10;

    for (let i = start + warmup; i <= end - 3; i++) {
      if (traded) break;
      if (closes[i] == null || ema10[i] == null || ema20[i] == null) continue;
      if (!isGoodHour(timestamps[i])) continue;

      const price = closes[i];
      const e10 = ema10[i], e20 = ema20[i];
      const e10slope = ema10[i] - ema10[Math.max(0, i-3)];
      const vwap = dayVwaps[i - start];

      // Volume
      const volSlice = volumes.slice(Math.max(0, i-20), i+1).filter(v => v != null && v > 0);
      const avgVol = volSlice.length ? volSlice.reduce((a,b) => a+b, 0) / volSlice.length : 1;
      const highVol = (volumes[i] || 0) > avgVol * 1.5;

      // SPY convergence
      const spyNow = spyCloses[Math.min(i, spyCloses.length-1)];
      const spyPct = spyOpen ? ((spyNow - spyOpen) / spyOpen) * 100 : 0;
      const spy3ago = spyCloses[Math.max(0, Math.min(i-3, spyCloses.length-1))];
      const spyTrend = spyNow - spy3ago;

      const prev1 = closes[i-1], prevOpen1 = opens[i-1];

      // Chop detection
      const rangeH = Math.max(...highs.slice(Math.max(start, i-30), i+1).filter(v => v != null));
      const rangeL = Math.min(...lows.slice(Math.max(start, i-30), i+1).filter(v => v != null));
      const rangePct = ((rangeH - rangeL) / price) * 100;
      let hTouches = 0, lTouches = 0;
      for (let j = Math.max(start, i-30); j <= i; j++) {
        if (highs[j] >= rangeH * 0.998) hTouches++;
        if (lows[j] <= rangeL * 1.002) lTouches++;
      }
      const isChop = hTouches >= 3 && lTouches >= 3 && rangePct < 1.5;
      if (isChop) continue;

      // Sweep detection
      const sweepLow = lows[i] < rangeL * 1.001 && closes[i] > rangeL && (closes[i] - lows[i]) > Math.abs(closes[i] - opens[i]) * 1.5;
      const sweepHigh = highs[i] > rangeH * 0.999 && closes[i] < rangeH && (highs[i] - closes[i]) > Math.abs(closes[i] - opens[i]) * 1.5;

      // VWAP reclaim
      const wasBelowVwap = vwap && closes[i-3] < vwap && closes[i-2] < vwap;
      const nowAboveVwap = vwap && price > vwap;
      const vwapReclaim = wasBelowVwap && nowAboveVwap;

      // === SCORE CALL ===
      let callScore = 0; const callR = [];
      if (price > e10 && e10slope > 0.05) { callScore += 2; callR.push('EMA10↑'); }
      if (e10 > e20) { callScore += 1; callR.push('EMA10>20'); }
      if (vwap && price > vwap) { callScore += 2; callR.push('VWAP↑'); }
      if (vwapReclaim) { callScore += 3; callR.push('VWAP_reclaim'); }
      if (spyPct > 0.1 && spyTrend > 0) { callScore += 2; callR.push('SPY↑'); }
      if (highVol) { callScore += 1; callR.push('Vol↑'); }
      if (sweepLow) { callScore += 2; callR.push('Sweep↓'); }
      if (prev1 < prevOpen1 && closes[i] > opens[i]) { callScore += 1; callR.push('Bounce'); }

      // === SCORE PUT ===
      let putScore = 0; const putR = [];
      if (price < e10 && e10slope < -0.05) { putScore += 2; putR.push('EMA10↓'); }
      if (e10 < e20) { putScore += 1; putR.push('EMA10<20'); }
      if (vwap && price < vwap) { putScore += 2; putR.push('VWAP↓'); }
      if (spyPct < -0.1 && spyTrend < 0) { putScore += 2; putR.push('SPY↓'); }
      if (highVol) { putScore += 1; putR.push('Vol↑'); }
      if (sweepHigh) { putScore += 2; putR.push('Sweep↑'); }
      if (prev1 > prevOpen1 && closes[i] < opens[i]) { putScore += 1; putR.push('Rejection'); }

      let direction = null, score = 0, reasons = [];
      if (callScore >= 5 && callScore > putScore) { direction = 'CALL'; score = callScore; reasons = callR; }
      else if (putScore >= 5 && putScore > callScore) { direction = 'PUT'; score = putScore; reasons = putR; }
      if (!direction) continue;

      // Daily trend filter
      if (direction === 'CALL' && dayTrend === 'DOWN') continue;
      if (direction === 'PUT' && dayTrend === 'UP') continue;

      // SPY extreme
      const spyDayLow = Math.min(...spyLows.slice(start, i+1).filter(v => v != null));
      const spyDayHigh = Math.max(...spyHighs.slice(start, i+1).filter(v => v != null));
      if (direction === 'CALL' && (spyNow - spyDayLow) < 0.50) continue;
      if (direction === 'PUT' && (spyDayHigh - spyNow) < 0.50) continue;

      // Adaptive stop
      let stopDist;
      if (price < 100) stopDist = 0.50;
      else if (price < 250) stopDist = 1.0;
      else if (price < 400) stopDist = 1.5;
      else if (price < 550) stopDist = 2.0;
      else stopDist = 2.5;
      const targetDist = stopDist * 3;

      let stop = direction === 'CALL' ? price - stopDist : price + stopDist;
      let target = direction === 'CALL' ? price + targetDist : price - targetDist;

      // Simulate
      let result = 'EOD', exitPrice = closes[end] || price, beTriggered = false, currentStop = stop, maxFav = 0;
      for (let j = i + 1; j <= end; j++) {
        if (highs[j] == null || lows[j] == null) continue;
        if (direction === 'CALL') {
          maxFav = Math.max(maxFav, highs[j] - price);
          if (highs[j] - price >= stopDist && !beTriggered) { currentStop = price; beTriggered = true; }
          if (lows[j] <= currentStop) { result = beTriggered ? 'BE' : 'STOP'; exitPrice = currentStop; break; }
          if (highs[j] >= target) { result = 'TARGET'; exitPrice = target; break; }
        } else {
          maxFav = Math.max(maxFav, price - lows[j]);
          if (price - lows[j] >= stopDist && !beTriggered) { currentStop = price; beTriggered = true; }
          if (highs[j] >= currentStop) { result = beTriggered ? 'BE' : 'STOP'; exitPrice = currentStop; break; }
          if (lows[j] <= target) { result = 'TARGET'; exitPrice = target; break; }
        }
      }

      const pnl = direction === 'CALL' ? exitPrice - price : price - exitPrice;
      let setup = score >= 8 ? 'A+' : score >= 6 ? 'A' : 'B';
      const time = new Date(timestamps[i] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      allTrades.push({
        time, ticker, signal: direction, score, setup,
        entry: +price.toFixed(2),
        sl: +stop.toFixed(2),
        tp: +target.toFixed(2),
        exitPrice: +exitPrice.toFixed(2),
        pnl: +pnl.toFixed(2),
        exitType: result,
        result: pnl > 0 ? 'WIN' : pnl === 0 ? 'BE' : result === 'EOD' ? 'OPEN' : 'LOSS',
        reasons: reasons.join(', '),
        maxFav: +maxFav.toFixed(2),
        dayTrend,
        spyPct: +spyPct.toFixed(2),
        vwapReclaim,
      });

      traded = true; // MAX 1 trade per ticker per day
    }
    console.log(traded ? `TRADE` : 'no signal');
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`/LIVE STRATEGY RESULTS — ${today}\n`);
  console.log(`${'Hora'.padEnd(9)} ${'Tkr'.padEnd(6)} ${'Dir'.padEnd(5)} ${'Sc'.padEnd(3)} ${'Grd'.padEnd(3)} ${'Entry'.padEnd(8)} ${'SL'.padEnd(8)} ${'TP'.padEnd(9)} ${'Exit'.padEnd(8)} ${'PnL'.padEnd(8)} ${'Res'.padEnd(6)} ${'MaxF'.padEnd(6)} ${'Trend'.padEnd(7)} Razones`);
  console.log('-'.repeat(100));

  for (const t of allTrades) {
    console.log(
      `${t.time.padEnd(9)} ${t.ticker.padEnd(6)} ${t.signal.padEnd(5)} ${String(t.score).padEnd(3)} ${t.setup.padEnd(3)} $${String(t.entry).padEnd(7)} $${String(t.sl).padEnd(7)} $${String(t.tp).padEnd(8)} $${String(t.exitPrice).padEnd(7)} ${(t.pnl>=0?'+':'')+t.pnl.toFixed(2).padStart(6)} ${t.result.padEnd(6)} $${t.maxFav.toFixed(2).padStart(5)} ${t.dayTrend.padEnd(7)} ${t.reasons}`
    );
  }

  const w = allTrades.filter(t => t.result === 'WIN').length;
  const l = allTrades.filter(t => t.result === 'LOSS').length;
  const b = allTrades.filter(t => t.result === 'BE').length;
  const o = allTrades.filter(t => t.result === 'OPEN').length;
  const pnl = allTrades.filter(t => t.result !== 'OPEN').reduce((s, t) => s + t.pnl, 0);

  console.log(`\nTrades: ${allTrades.length} | W: ${w} | L: ${l} | BE: ${b} | Open: ${o} | PnL: $${pnl.toFixed(2)}`);
  console.log(`(Nota: max 1 trade por ticker por dia, score min 5, con tendencia diaria)`);
}

run().catch(console.error);
