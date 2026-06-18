// Backtest ICT Smart Money — Last 5 trading days with real Yahoo data
const TICKERS = ['QQQ', 'SPY'];
const DOLLAR_PER_MOVE = 50;

async function fetchYahoo(ticker, interval = '1m', range = '5d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getMinET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }

function miniEMA(a, p) { if (!a || a.length < p) return []; const k = 2 / (p + 1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i] * k + e[i - 1] * (1 - k) : e[i - 1]); return e; }
function miniVWAP(h, l, c, v) { const vw = []; let n = 0, d = 0; for (let i = 0; i < c.length; i++) { if (h[i] != null && l[i] != null && c[i] != null && v[i] != null) { n += ((h[i] + l[i] + c[i]) / 3) * v[i]; d += v[i]; } vw.push(d ? +(n / d).toFixed(4) : null); } return vw; }

function detectSwingLevels(h, l, start, end) {
  const levels = [];
  for (let i = Math.max(start + 1, 2); i < end - 1; i++) {
    if (h[i] != null && h[i - 1] != null && h[i + 1] != null && h[i] > h[i - 1] && h[i] > h[i + 1]) levels.push({ type: 'HIGH', price: h[i], idx: i });
    if (l[i] != null && l[i - 1] != null && l[i + 1] != null && l[i] < l[i - 1] && l[i] < l[i + 1]) levels.push({ type: 'LOW', price: l[i], idx: i });
  }
  return levels;
}

let FIXED_SL = 0.50;
let TP_MULT = 3;

async function backtestDay(dateStr, allData, spyD, vixD) {
  const trades = [];

  for (const ticker of TICKERS) {
    const data = allData[ticker];
    if (!data) continue;

    const dayCandles = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      if (getDateET(data.timestamps[i]) !== dateStr) continue;
      const m = getMinET(data.timestamps[i]);
      if (m >= 575 && m < 955) dayCandles.push(i);
    }
    if (dayCandles.length < 30) continue;

    const dc = dayCandles;
    const h = data.highs, l = data.lows, o = data.opens, c = data.closes, v = data.volumes;
    const dH = dc.map(i => h[i]), dL = dc.map(i => l[i]), dC = dc.map(i => c[i]), dV = dc.map(i => v[i]), dO = dc.map(i => o[i]);
    const vwap = miniVWAP(dH, dL, dC, dV);
    const ema9 = miniEMA(dC, 9), ema21 = miniEMA(dC, 21);

    let inTrade = false;

    for (let j = 20; j < dc.length - 5; j++) {
      if (inTrade) continue;
      const idx = j;
      const price = dC[idx];
      if (!price) continue;

      const vwapNow = vwap[idx];
      const e9 = ema9[idx], e21 = ema21[idx];
      let bias = 'NEUTRAL';
      if (price > vwapNow && e9 > e21) bias = 'BULLISH';
      else if (price < vwapNow && e9 < e21) bias = 'BEARISH';
      if (bias === 'NEUTRAL') continue;

      const levels = detectSwingLevels(dH, dL, Math.max(0, idx - 20), idx);

      let sweep = null;
      for (let k = Math.max(idx - 3, 0); k <= idx; k++) {
        if (!dC[k] || !dO[k] || !dH[k] || !dL[k]) continue;
        const body = Math.abs(dC[k] - dO[k]);
        const wickDn = Math.min(dC[k], dO[k]) - dL[k];
        const wickUp = dH[k] - Math.max(dC[k], dO[k]);
        for (const lv of levels) {
          if (lv.type === 'LOW' && dL[k] < lv.price && dC[k] > lv.price && wickDn > body * 1.2)
            sweep = { type: 'BULL', level: lv.price, sweepLow: dL[k], candleIdx: k };
          if (lv.type === 'HIGH' && dH[k] > lv.price && dC[k] < lv.price && wickUp > body * 1.2)
            sweep = { type: 'BEAR', level: lv.price, sweepHigh: dH[k], candleIdx: k };
        }
      }
      if (!sweep) continue;

      let mss = false;
      if (sweep.type === 'BULL') {
        let recentHigh = -Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 8); k < sweep.candleIdx; k++) { if (dH[k] > recentHigh) recentHigh = dH[k]; }
        for (let k = sweep.candleIdx + 1; k <= idx; k++) { if (dH[k] > recentHigh) { mss = true; break; } }
      } else {
        let recentLow = Infinity;
        for (let k = Math.max(0, sweep.candleIdx - 8); k < sweep.candleIdx; k++) { if (dL[k] < recentLow) recentLow = dL[k]; }
        for (let k = sweep.candleIdx + 1; k <= idx; k++) { if (dL[k] < recentLow) { mss = true; break; } }
      }
      if (!mss) continue;

      // SPY/VIX convergence
      const targetTs = data.timestamps[dc[idx]];
      let spyOk = false, vixOk = false;
      if (spyD) {
        let si = -1;
        for (let i = spyD.timestamps.length - 1; i >= 0; i--) { if (spyD.timestamps[i] <= targetTs) { si = i; break; } }
        if (si >= 3 && spyD.closes[si] != null && spyD.closes[si - 3] != null) {
          const chg = spyD.closes[si] - spyD.closes[si - 3];
          spyOk = bias === 'BULLISH' ? chg > 0 : chg < 0;
        }
      }
      if (vixD) {
        let vi = -1;
        for (let i = vixD.timestamps.length - 1; i >= 0; i--) { if (vixD.timestamps[i] <= targetTs) { vi = i; break; } }
        if (vi >= 3 && vixD.closes[vi] != null && vixD.closes[vi - 3] != null) {
          const chg = vixD.closes[vi] - vixD.closes[vi - 3];
          vixOk = bias === 'BULLISH' ? chg < 0 : chg > 0;
        }
      }

      // Score
      let score = 4; // sweep(2) + mss(2)
      if ((bias === 'BULLISH' && price > vwapNow) || (bias === 'BEARISH' && price < vwapNow)) score += 2;
      if (spyOk) score += 1;
      if (vixOk) score += 1;
      // RVOL
      const avgVol = dV.slice(Math.max(0, idx - 20), idx).filter(x => x > 0).reduce((a, b) => a + b, 0) / 20;
      const rvol = avgVol ? +((dV[idx] || 0) / avgVol).toFixed(2) : 0;
      if (rvol >= 1.5) score += 1;

      // Killzone
      const candleMin = getMinET(data.timestamps[dc[idx]]);
      const kz = candleMin >= 575 && candleMin <= 660 ? 'MORNING' : candleMin >= 840 && candleMin <= 930 ? 'POWER_HOUR' : candleMin > 660 && candleMin < 840 ? 'MIDDAY' : 'REGULAR';
      if (kz === 'MIDDAY') score = Math.max(0, score - 2);

      if (score < 5) continue;

      const dir = bias === 'BULLISH' ? 'CALL' : 'PUT';
      const entry = +price.toFixed(2);
      const slDist = FIXED_SL;
      const tp1Dist = slDist * TP_MULT;
      const tp2Dist = slDist * TP_MULT;
      const sl = dir === 'CALL' ? +(entry - slDist).toFixed(2) : +(entry + slDist).toFixed(2);
      const tp1 = dir === 'CALL' ? +(entry + tp1Dist).toFixed(2) : +(entry - tp1Dist).toFixed(2);
      const tp2 = dir === 'CALL' ? +(entry + tp2Dist).toFixed(2) : +(entry - tp2Dist).toFixed(2);

      let exitPrice = null, resultado = 'CIERRE';
      const tp = tp2; // single TP target
      for (let f = idx + 1; f < dc.length; f++) {
        if (dir === 'CALL') {
          if (dL[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (dH[f] >= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
        } else {
          if (dH[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (dL[f] <= tp) { exitPrice = tp; resultado = 'TARGET'; break; }
        }
      }
      if (!exitPrice) { exitPrice = dC[dc.length - 1] || entry; resultado = 'CIERRE'; }

      const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
      const hora = new Date(data.timestamps[dc[idx]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      trades.push({
        fecha: dateStr, hora, ticker, dir, entry, sl: +sl.toFixed(2), tp1: +tp1.toFixed(2), tp2: +tp2.toFixed(2),
        exit: +exitPrice.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
        resultado, score, kz, rvol,
        setup: sweep.type === 'BULL' ? 'Sweep↑+MSS' : 'Sweep↓+MSS',
        spyOk, vixOk, bias,
      });
      inTrade = true;
    }
  }
  return trades;
}

function summarize(label, trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalC = trades.reduce((s, t) => s + t.pnlC, 0);
  const wr = trades.length ? (wins.length / trades.length * 100).toFixed(0) : 0;
  const avgW = wins.length ? (wins.reduce((s, t) => s + t.pnlC, 0) / wins.length).toFixed(0) : 0;
  const avgL = losses.length ? (losses.reduce((s, t) => s + t.pnlC, 0) / losses.length).toFixed(0) : 0;
  const pf = losses.length ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';
  return { label, total: trades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BACKTEST ICT SMART MONEY — SL $0.50 fijo — Ultima semana');
  console.log('  Tickers: QQQ, SPY | Delta $50/move | Riesgo $25/trade');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Fetching Yahoo data...\n');

  const allData = {};
  for (const t of TICKERS) {
    allData[t] = await fetchYahoo(t, '1m', '5d');
    if (!allData[t]) console.log(`⚠️  No data for ${t}`);
  }
  const spyD = allData['SPY'] || await fetchYahoo('SPY', '1m', '5d');
  const vixD = await fetchYahoo('^VIX', '1m', '5d');

  const allTs = [];
  for (const t of TICKERS) { if (allData[t]) allTs.push(...allData[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`Dias: ${dates.join(', ')}\n`);

  // Test multiple configs
  const configs = [
    { sl: 0.50, tp: 2, label: 'SL $0.50 | TP 1:2 ($1.00)' },
    { sl: 0.50, tp: 3, label: 'SL $0.50 | TP 1:3 ($1.50)' },
    { sl: 0.50, tp: 4, label: 'SL $0.50 | TP 1:4 ($2.00)' },
    { sl: 0.75, tp: 2, label: 'SL $0.75 | TP 1:2 ($1.50)' },
    { sl: 0.75, tp: 3, label: 'SL $0.75 | TP 1:3 ($2.25)' },
    { sl: 1.00, tp: 2, label: 'SL $1.00 | TP 1:2 ($2.00)' },
    { sl: 1.00, tp: 3, label: 'SL $1.00 | TP 1:3 ($3.00)' },
  ];

  const results = [];

  for (const cfg of configs) {
    FIXED_SL = cfg.sl;
    TP_MULT = cfg.tp;
    const allTrades = [];
    for (const d of dates) {
      const dt = await backtestDay(d, allData, spyD, vixD);
      allTrades.push(...dt);
    }
    const s = summarize(cfg.label, allTrades);
    results.push({ ...s, trades: allTrades });
  }

  // Comparison table
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('  COMPARACION DE CONFIGURACIONES');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log(`${'Config'.padEnd(30)} ${'Trades'.padEnd(8)} ${'WR'.padEnd(6)} ${'Wins'.padEnd(6)} ${'Loss'.padEnd(6)} ${'PnL'.padEnd(10)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'PF'.padEnd(6)} Cuenta`);
  console.log('─'.repeat(100));

  for (const r of results) {
    const pnlStr = (r.totalC >= 0 ? '+$' : '-$') + Math.abs(r.totalC);
    const cuenta = 2000 + r.totalC;
    const star = r.totalC > 0 ? ' ⭐' : '';
    console.log(`${r.label.padEnd(30)} ${String(r.total).padEnd(8)} ${(r.wr+'%').padEnd(6)} ${String(r.wins).padEnd(6)} ${String(r.losses).padEnd(6)} ${pnlStr.padEnd(10)} +$${r.avgW.toString().padEnd(6)} $${r.avgL.toString().padEnd(7)} ${r.pf.padEnd(6)} $${cuenta.toLocaleString()}${star}`);
  }

  // Show best config details
  const best = results.reduce((a, b) => a.totalC > b.totalC ? a : b);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  MEJOR CONFIG: ${best.label}`);
  console.log(`═══════════════════════════════════════════════════════════════`);

  console.log(`\n${'Fecha'.padEnd(12)} ${'Hora'.padEnd(8)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(9)} ${'SL'.padEnd(9)} ${'TP'.padEnd(9)} ${'Exit'.padEnd(9)} ${'$Cont'.padEnd(8)} ${'Score'.padEnd(6)} ${'KZ'.padEnd(12)} Res`);
  console.log('─'.repeat(100));
  for (const t of best.trades) {
    const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
    const res = t.resultado === 'TARGET' ? '✅ TARGET' : t.resultado === 'STOP' ? '❌ STOP' : '⚪ CIERRE';
    console.log(`${t.fecha.padEnd(12)} ${t.hora.padEnd(8)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${t.entry.toString().padEnd(8)} $${t.sl.toString().padEnd(8)} $${t.tp2.toString().padEnd(8)} $${t.exit.toString().padEnd(8)} ${pnlCStr.padEnd(8)} ${(t.score+'/10').padEnd(6)} ${t.kz.padEnd(12)} ${res}`);
  }

  // Per day for best
  console.log('\n── Por Dia ──');
  for (const d of dates) {
    const dt = best.trades.filter(t => t.fecha === d);
    if (dt.length === 0) { console.log(`  ${d}: Sin trades`); continue; }
    const dw = dt.filter(t => t.pnl > 0).length;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    console.log(`  ${d}: ${dt.length} trades | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp}`);
  }
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
