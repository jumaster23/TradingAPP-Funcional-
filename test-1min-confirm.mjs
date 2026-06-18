// 1MIN CONFIRMATION: Wait for 1min candle to CLOSE above PMH (not just touch)
// Adaptive SL by price: NVDA/PLTR=$0.50, AAPL/GOOGL=$1.00, SPY/QQQ/MSFT/META/AMD/TSLA=$1.50
// TP = 2x SL | Also test TP = 1.5x and TP = 3x

const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

function getFixedStop(ticker) {
  if (ticker === 'NVDA' || ticker === 'PLTR') return 0.50;
  if (ticker === 'AAPL' || ticker === 'GOOGL') return 1.00;
  return 1.50; // SPY, QQQ, MSFT, META, AMD, TSLA
}

async function fetchChart(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function calcEMA(a, p) { if (!a || a.length < p) return []; const k = 2 / (p + 1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i] * k + e[i - 1] * (1 - k) : e[i - 1]); return e; }
function getMinutesET(ts) { const d = new Date(ts * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDayKeyET(ts) { const d = new Date(ts * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`; }
function groupByDay(ts) { const d = {}; for (let i = 0; i < ts.length; i++) { const k = getDayKeyET(ts[i]); if (!d[k]) d[k] = []; d[k].push(i); } return d; }

function check5m(data, ts, dir, inv) {
  let idx = -1; for (let i = data.timestamps.length - 1; i >= 0; i--) { if (data.timestamps[i] <= ts) { idx = i; break; } }
  if (idx < 3) return false; const c = data.closes;
  if (c[idx] == null || c[idx - 3] == null) return false;
  const chg = c[idx] - c[idx - 3];
  if (inv) return dir === 'CALL' ? chg < 0 : chg > 0;
  return dir === 'CALL' ? chg > 0 : chg < 0;
}

async function run() {
  console.log('Loading convergence + 1min data...');
  const [spxD, vixD] = await Promise.all([fetchChart('^GSPC', '5m', '1mo'), fetchChart('^VIX', '5m', '1mo')]);

  const configs = [
    { label: 'SL fijo, TP=2x', tpMult: 2 },
    { label: 'SL fijo, TP=1.5x', tpMult: 1.5 },
    { label: 'SL fijo, TP=1x', tpMult: 1 },
    { label: 'SL fijo, TP=3x', tpMult: 3 },
  ];

  const results = {};
  for (const cfg of configs) results[cfg.label] = [];

  for (const ticker of TICKERS) {
    process.stdout.write(`${ticker}... `);

    // Need 1min for entry confirmation + 5min for PM levels
    const [data1m, data5m, dailyData] = await Promise.all([
      fetchChart(ticker, '1m', '8d'),
      fetchChart(ticker, '5m', '1mo'),
      fetchChart(ticker, '1d', '3mo'),
    ]);
    if (!data1m || !data5m) { console.log('skip'); continue; }

    const days5m = groupByDay(data5m.timestamps);
    const days1m = groupByDay(data1m.timestamps);
    const dCloses = dailyData ? dailyData.closes.filter(v => v != null) : [];
    const dTs = dailyData ? dailyData.timestamps : [];
    const dEma10 = calcEMA(dCloses, 10);

    function getDayTrend(dk) {
      if (dCloses.length < 12) return 'NEUTRAL';
      const ts = new Date(dk + 'T12:00:00').getTime() / 1000;
      let idx = -1; for (let i = dTs.length - 1; i >= 0; i--) { if (dTs[i] <= ts + 86400) { idx = i; break; } }
      if (idx < 10) return 'NEUTRAL';
      if (dCloses[idx] > dEma10[idx] && dCloses[idx - 1] > dCloses[idx - 2]) return 'UP';
      if (dCloses[idx] < dEma10[idx] && dCloses[idx - 1] < dCloses[idx - 2]) return 'DOWN';
      return 'NEUTRAL';
    }

    const sd = getFixedStop(ticker);
    let tc = 0;

    // Only process days that exist in BOTH 1m and 5m
    const commonDays = Object.keys(days1m).filter(dk => days5m[dk]);

    for (const dk of commonDays) {
      const indices5m = days5m[dk];
      const indices1m = days1m[dk];
      if (!indices5m || indices5m.length < 15 || !indices1m || indices1m.length < 50) continue;
      const dt = getDayTrend(dk);

      // PMH/PML from 5min premarket
      let pmh = -Infinity, pml = Infinity;
      for (const ci of indices5m) {
        const m = getMinutesET(data5m.timestamps[ci]);
        if (m >= 240 && m < 570) {
          const h = data5m.highs[ci], l = data5m.lows[ci];
          if (h != null && l != null && (h - l) / h > 0.05) continue;
          if (h != null && h > pmh) pmh = h;
          if (l != null && l < pml) pml = l;
        }
      }
      if (pmh === -Infinity) continue;
      const pmRange = pmh - pml;
      if (pmRange > 6) continue;

      // ORB from first 5min candle
      let orbH = null, orbL = null;
      for (const ci of indices5m) {
        const m = getMinutesET(data5m.timestamps[ci]);
        if (m >= 570 && m < 575) { orbH = data5m.highs[ci]; orbL = data5m.lows[ci]; break; }
      }
      if (!orbH || !orbL) continue;

      // VWAP from 1min regular hours
      let vN = 0, vD = 0;
      const vwapAt = {};
      for (const ci of indices1m) {
        const m = getMinutesET(data1m.timestamps[ci]);
        if (m >= 570) {
          if (data1m.highs[ci] != null && data1m.lows[ci] != null && data1m.closes[ci] != null && data1m.volumes[ci] != null) {
            vN += ((data1m.highs[ci] + data1m.lows[ci] + data1m.closes[ci]) / 3) * data1m.volumes[ci];
            vD += data1m.volumes[ci];
          }
          vwapAt[ci] = vD ? vN / vD : null;
        }
      }

      // Walk 1min candles after 9:31 (skip first minute noise)
      const reg1m = indices1m.filter(ci => { const m = getMinutesET(data1m.timestamps[ci]); return m >= 571 && m < 955; });

      let orbBrokeUp = false, pmhBroke = false;
      let orbBrokeDown = false, pmlBroke = false;
      let callDone = false, putDone = false;

      for (let ri = 0; ri < reg1m.length - 1; ri++) {
        const ci = reg1m[ri];
        const h = data1m.highs[ci], l = data1m.lows[ci], c = data1m.closes[ci], o = data1m.opens[ci];
        if (!h || !l || !c || !o) continue;
        const cts = data1m.timestamps[ci];
        const time = new Date(cts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

        if (h > orbH) orbBrokeUp = true;
        if (h > pmh) pmhBroke = true;
        if (l < orbL) orbBrokeDown = true;
        if (l < pml) pmlBroke = true;

        const vwap = vwapAt[ci];

        // CALL: 1min candle CLOSES above PMH + ORB broken + VWAP + convergence
        if (orbBrokeUp && pmhBroke && !callDone && c > pmh && dt !== 'DOWN') {
          const aboveVwap = !vwap || c > vwap;
          const spxOk = check5m(spxD, cts, 'CALL', false);
          const vixOk = check5m(vixD, cts, 'CALL', true);

          if (aboveVwap && spxOk && vixOk) {
            callDone = true; tc++;
            const entry = +c.toFixed(2); // enter at CLOSE of confirmation candle

            for (const cfg of configs) {
              const sl = +(entry - sd).toFixed(2);
              const tp = +(entry + sd * cfg.tpMult).toFixed(2);

              // Simulate on 1min candles
              let pnl = 0, exitType = 'EOD', exitTime = time;
              for (let j = ri + 1; j < reg1m.length; j++) {
                const jci = reg1m[j]; const jh = data1m.highs[jci], jl = data1m.lows[jci]; if (!jh || !jl) continue;
                if (jl <= sl) { pnl = sl - entry; exitType = 'STOP'; exitTime = new Date(data1m.timestamps[jci] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }); break; }
                if (jh >= tp) { pnl = tp - entry; exitType = 'TARGET'; exitTime = new Date(data1m.timestamps[jci] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }); break; }
              }
              if (exitType === 'EOD') { const ep = data1m.closes[reg1m[reg1m.length - 1]] || entry; pnl = ep - entry; }

              results[cfg.label].push({
                date: dk, time, exitTime, ticker, dir: 'CALL',
                entry, sl, tp, sd,
                pnl: +pnl.toFixed(2), exitType,
                result: pnl > 0 ? 'WIN' : exitType === 'STOP' ? 'LOSS' : 'BE',
              });
            }
          }
        }

        // PUT: 1min candle CLOSES below PML + ORB broken + VWAP + convergence
        if (orbBrokeDown && pmlBroke && !putDone && c < pml && dt !== 'UP') {
          const belowVwap = !vwap || c < vwap;
          const spxOk = check5m(spxD, cts, 'PUT', false);
          const vixOk = check5m(vixD, cts, 'PUT', true);

          if (belowVwap && spxOk && vixOk) {
            putDone = true; tc++;
            const entry = +c.toFixed(2);

            for (const cfg of configs) {
              const sl = +(entry + sd).toFixed(2);
              const tp = +(entry - sd * cfg.tpMult).toFixed(2);

              let pnl = 0, exitType = 'EOD', exitTime = time;
              for (let j = ri + 1; j < reg1m.length; j++) {
                const jci = reg1m[j]; const jh = data1m.highs[jci], jl = data1m.lows[jci]; if (!jh || !jl) continue;
                if (jh >= sl) { pnl = entry - sl; exitType = 'STOP'; exitTime = new Date(data1m.timestamps[jci] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }); break; }
                if (jl <= tp) { pnl = entry - tp; exitType = 'TARGET'; exitTime = new Date(data1m.timestamps[jci] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }); break; }
              }
              if (exitType === 'EOD') { const ep = data1m.closes[reg1m[reg1m.length - 1]] || entry; pnl = entry - ep; }

              results[cfg.label].push({
                date: dk, time, exitTime, ticker, dir: 'PUT',
                entry, sl, tp, sd,
                pnl: +pnl.toFixed(2), exitType,
                result: pnl > 0 ? 'WIN' : exitType === 'STOP' ? 'LOSS' : 'BE',
              });
            }
          }
        }
      }
    }
    console.log(`${tc}`);
    await new Promise(r => setTimeout(r, 300));
  }

  const MULT = 50;
  console.log('\n' + '='.repeat(110));
  console.log('1MIN CONFIRMACION — Cierre de 1min arriba del nivel, SL fijo por ticker');
  console.log('SL: NVDA/PLTR=$0.50 | AAPL/GOOGL=$1.00 | SPY/QQQ/MSFT/META/AMD/TSLA=$1.50');
  console.log('='.repeat(110));

  for (const [label, trades] of Object.entries(results)) {
    const w = trades.filter(t => t.result === 'WIN').length;
    const l = trades.filter(t => t.result === 'LOSS').length;
    const b = trades.filter(t => t.result === 'BE').length;
    const pnl = trades.reduce((s, t) => s + t.pnl, 0);
    const gw = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const days = new Set(trades.map(t => t.date)).size;
    console.log(`\n${label}`);
    console.log(`  ${trades.length} trades (${days}d, ${(trades.length / days).toFixed(1)}/d) | ${w}W ${l}L ${b}BE | WR ${((w / trades.length) * 100).toFixed(0)}% | WR real ${(((w + b) / trades.length) * 100).toFixed(0)}% | PF ${gl > 0 ? (gw / gl).toFixed(2) : '∞'} | $${(pnl * MULT).toFixed(0)} ($${(pnl * MULT / days).toFixed(0)}/d)`);
  }

  // Show trades for best config
  const best = results['SL fijo, TP=2x'];
  console.log('\n\n' + '='.repeat(130));
  console.log('DETALLE: SL fijo TP=2x');
  console.log('='.repeat(130));
  console.log(`\n${'Fecha'.padEnd(11)} ${'Hora'.padEnd(9)} ${'Exit'.padEnd(9)} ${'Tkr'.padEnd(6)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'StopD'.padEnd(6)} ${'PnL'.padEnd(8)} ${'$2c'.padEnd(7)} Res`);
  console.log('-'.repeat(110));

  best.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  let currentDay = '';
  for (const t of best) {
    if (t.date !== currentDay && currentDay) {
      const dt = best.filter(x => x.date === currentDay);
      const dp = dt.reduce((s, x) => s + x.pnl, 0) * MULT;
      console.log(`${''.padEnd(85)} DIA: ${dp >= 0 ? '+' : ''}$${dp.toFixed(0)}`); console.log('');
    }
    currentDay = t.date;
    const cp = t.pnl * MULT; const icon = t.result === 'WIN' ? '✅' : t.result === 'BE' ? '⚪' : '❌';
    console.log(`${t.date.padEnd(11)} ${t.time.padEnd(9)} ${t.exitTime.padEnd(9)} ${t.ticker.padEnd(6)} ${t.dir.padEnd(5)} $${String(t.entry).padEnd(8)} $${String(t.sl).padEnd(8)} $${String(t.tp).padEnd(8)} $${t.sd.toFixed(2).padEnd(5)} ${(t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2).padStart(6)} ${(cp >= 0 ? '+' : '') + '$' + cp.toFixed(0).padStart(4)} ${icon}${t.result}`);
  }
  { const dt = best.filter(x => x.date === currentDay); const dp = dt.reduce((s, x) => s + x.pnl, 0) * MULT; console.log(`${''.padEnd(85)} DIA: ${dp >= 0 ? '+' : ''}$${dp.toFixed(0)}`); }

  // By ticker
  console.log('\n--- POR TICKER ---');
  for (const ticker of TICKERS) {
    const tt = best.filter(t => t.ticker === ticker); if (!tt.length) continue;
    const tw = tt.filter(t => t.result === 'WIN').length, tl = tt.filter(t => t.result === 'LOSS').length, tb = tt.filter(t => t.result === 'BE').length;
    console.log(`  ${ticker.padEnd(6)} SL=$${getFixedStop(ticker).toFixed(2)} | ${tt.length} trades | ${tw}W ${tl}L ${tb}BE | WR ${(((tw + tb) / tt.length) * 100).toFixed(0)}% | $${(tt.reduce((s, t) => s + t.pnl, 0) * MULT).toFixed(0)}`);
  }
}

run().catch(console.error);
