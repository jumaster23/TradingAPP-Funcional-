import fs from 'fs';

async function fetchMultiTimeframeData(ticker, range = '1mo') {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=${range}`);
  const json = await res.json();
  return json?.chart?.result?.[0];
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < 2 || !lows || lows.length < 2 || !closes || closes.length < 2) return null;
  const trs = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

async function runTest() {
  console.log("Fetching data for SPY...");
  const data1m = await fetchMultiTimeframeData('SPY', '1mo');
  const quote = data1m.indicators.quote[0];
  const closes = quote.close.filter(v => v != null);
  const highs = quote.high.filter(v => v != null);
  const lows = quote.low.filter(v => v != null);
  const volumes = quote.volume.filter(v => v != null);
  const timestamps = data1m.timestamp;

  console.log(`Loaded ${closes.length} 1m bars.`);

  let trades = [];
  const lookahead = 120; // 2 hours
  const warmup = 50;

  for (let i = warmup; i < closes.length - lookahead; i++) {
    const price = closes[i];
    const high = highs[i];
    const low = lows[i];

    // Build trend
    const sma20 = closes.slice(i-20, i).reduce((a,b)=>a+b,0)/20;
    const sma50 = closes.slice(i-50, i).reduce((a,b)=>a+b,0)/50;

    // Pullback logic: Price was above SMA50, pulled back to SMA50, with wick rejection
    const isUptrend = sma20 > sma50;
    const isPullback = low <= sma50 && price > sma50;
    const wickSize = price - low;
    const bodySize = Math.abs(closes[i] - closes[i-1]||closes[i]);
    const isWickRejection = wickSize > bodySize * 2;

    const avgVol = volumes.slice(i-5, i).reduce((a,b)=>a+b,0)/5;
    const highVol = volumes[i] > avgVol * 1.5;

    if (isUptrend && isPullback && isWickRejection && highVol) {
      // Execute CALL
      const atr = calculateATR(highs.slice(i-14, i+1), lows.slice(i-14, i+1), closes.slice(i-14, i+1), 14);
      if (!atr) continue;

      // Risk 1 ATR, Reward 3 ATR
      const sl = price - (atr * 1.5);
      const tp = price + (atr * 4.5); // 1:3 ratio based on ATR

      let result = 'TIMEOUT';
      for (let j = 1; j <= lookahead && i + j < closes.length; j++) {
        if (highs[i+j] >= tp) { result = 'WIN'; break; }
        if (lows[i+j] <= sl) { result = 'LOSS'; break; }
      }
      
      trades.push(result);
      i += 30; // Wait before next trade
    }
  }

  const wins = trades.filter(t => t === 'WIN').length;
  const losses = trades.filter(t => t === 'LOSS').length;
  const total = trades.length;
  const wr = total > 0 ? (wins / total) * 100 : 0;
  
  console.log(`Trades: ${total}`);
  console.log(`Wins: ${wins}, Losses: ${losses}`);
  console.log(`Win Rate: ${wr.toFixed(2)}%`);
}

runTest();
