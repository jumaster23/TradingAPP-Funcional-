// Backtest Live2 (ORB+PMH) — 60 days using 5min data
// SPY + VIX convergence | VWAP filter | PM 7:00-9:30 | Glitch filter
const BEST_TICKERS = ['MSFT', 'QQQ', 'NVDA', 'GOOGL'];
const SL_MAP = { MSFT: 0.75, QQQ: 0.75, NVDA: 0.75, GOOGL: 1.00 };
const TP_MAP = { MSFT: 2.50, QQQ: 2.50, NVDA: 2.50, GOOGL: 3.00 };
const DOLLAR_PER_MOVE = 50;

async function fetchYahoo(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getMinET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }

function filterDay(data, dateStr) {
  const candles = [];
  for (let i = 0; i < data.timestamps.length; i++) {
    if (getDateET(data.timestamps[i]) !== dateStr) continue;
    candles.push({ ts: data.timestamps[i], min: getMinET(data.timestamps[i]), o: data.opens[i], h: data.highs[i], l: data.lows[i], c: data.closes[i], v: data.volumes[i] });
  }
  return candles;
}

function backtestDay(dateStr, tickerData, spyD, vixD, ticker) {
  const dc = filterDay(tickerData, dateStr);
  if (dc.length < 10) return null;

  // PMH/PML from 7:00-9:30 (min 420-570)
  let pmh = -Infinity, pml = Infinity;
  for (const c of dc) {
    if (c.min >= 420 && c.min < 570) {
      if (c.h != null && c.l != null && c.h > 0 && (c.h - c.l) / c.h > 0.05) continue; // glitch filter
      if (c.h > pmh) pmh = c.h;
      if (c.l < pml) pml = c.l;
    }
  }
  if (pmh === -Infinity || pmh - pml > 6) return null;

  // ORB first 5min candle (9:30-9:35, min 570-575)
  let orbH = null, orbL = null;
  for (const c of dc) { if (c.min >= 570 && c.min < 575) { orbH = c.h; orbL = c.l; break; } }
  if (!orbH) return null;

  // VWAP (simple running average for 5min)
  let vN = 0, vD = 0; const vw = {};
  for (const c of dc) {
    if (c.min >= 570 && c.h && c.l && c.c) { vN += ((c.h + c.l + c.c) / 3); vD++; vw[c.ts] = vD ? vN / vD : null; }
  }

  // SPY/VIX convergence check function
  function checkConv(dir, targetTs) {
    function ck(data, d, inv) {
      if (!data) return false;
      const vi = [];
      for (let i = 0; i < data.timestamps.length; i++) { if (data.timestamps[i] <= targetTs && data.closes[i] != null) vi.push(i); }
      if (vi.length < 4) return false;
      const l4 = vi.slice(-4).map(i => data.closes[i]);
      const t3 = l4[3] - l4[0], t1 = l4[3] - l4[2];
      if (inv) return d === 'CALL' ? (t3 < 0 && t1 <= 0) : (t3 > 0 && t1 >= 0);
      return d === 'CALL' ? (t3 > 0 && t1 >= 0) : (t3 < 0 && t1 <= 0);
    }
    return ck(spyD, dir, false) && ck(vixD, dir, true);
  }

  // Walk market candles looking for CALL entry
  const mc = dc.filter(c => c.min >= 575 && c.min < 960);
  let oU = false, pH = false;

  for (const c of mc) {
    if (c.h > orbH) oU = true;
    if (c.h > pmh) pH = true;

    // CALL: ORB broken up + PMH broken + close > PMH + VWAP ok + convergence
    if (oU && pH && c.c > pmh && (!vw[c.ts] || c.c > vw[c.ts]) && checkConv('CALL', c.ts)) {
      const entry = +c.c.toFixed(2);
      const SL = SL_MAP[ticker] || 0.75;
      const TP = TP_MAP[ticker] || 2.50;
      const sl = +(entry - SL).toFixed(2);
      const tp = +(entry + TP).toFixed(2);

      let exit = null, resultado = 'CIERRE';
      for (const f of mc) {
        if (f.ts <= c.ts) continue;
        if (f.l <= sl) { exit = sl; resultado = 'STOP'; break; }
        if (f.h >= tp) { exit = tp; resultado = 'TARGET'; break; }
      }
      if (!exit) { exit = mc[mc.length - 1]?.c || entry; }

      const pnl = +(exit - entry).toFixed(2);
      const hora = new Date(c.ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      return {
        fecha: dateStr, hora, ticker, dir: 'CALL', entry, sl, tp,
        exit: +exit.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
        resultado, pmh: +pmh.toFixed(2), pml: +pml.toFixed(2),
        pmRange: +(pmh - pml).toFixed(2), orbH: +orbH.toFixed(2),
        slDist: SL, tpDist: TP,
      };
    }
  }
  return null;
}

function summarize(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalC = trades.reduce((s, t) => s + t.pnlC, 0);
  const wr = trades.length ? (wins.length / trades.length * 100).toFixed(0) : 0;
  const avgW = wins.length ? (wins.reduce((s, t) => s + t.pnlC, 0) / wins.length).toFixed(0) : 0;
  const avgL = losses.length ? (losses.reduce((s, t) => s + t.pnlC, 0) / losses.length).toFixed(0) : 0;
  const pf = losses.length && losses.reduce((s, t) => s + t.pnlC, 0) !== 0 ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';
  return { total: trades.length, wins: wins.length, losses: losses.length, wr, totalC, avgW, avgL, pf };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BACKTEST LIVE2 (ORB+PMH) — 60 DIAS (5min data)');
  console.log('  SPY + VIX convergence | VWAP filter | PM 7:00-9:30');
  console.log('  Tickers: MSFT, QQQ, NVDA, GOOGL | Delta $50/move');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Fetching 60d data...\n');
  const allData = {};
  for (const t of BEST_TICKERS) {
    process.stdout.write(`  ${t}...`);
    allData[t] = await fetchYahoo(t, '5m', '60d');
    console.log(allData[t] ? ` ✅ (${allData[t].timestamps.length} candles)` : ' ⚠️');
  }
  const spyD = await fetchYahoo('SPY', '5m', '60d');
  const vixD = await fetchYahoo('^VIX', '5m', '60d');

  // Get dates
  const allTs = [];
  for (const t of BEST_TICKERS) { if (allData[t]) allTs.push(...allData[t].timestamps); }
  const dates = [...new Set(allTs.map(t => getDateET(t)))].sort();
  console.log(`\nDias: ${dates.length} | Rango: ${dates[0]} → ${dates[dates.length - 1]}\n`);

  // Run
  const allTrades = [];
  for (const d of dates) {
    for (const ticker of BEST_TICKERS) {
      if (!allData[ticker]) continue;
      const trade = backtestDay(d, allData[ticker], spyD, vixD, ticker);
      if (trade) allTrades.push(trade);
    }
  }

  if (allTrades.length === 0) { console.log('❌ No trades.\n'); return; }

  const s = summarize(allTrades);

  // Print all trades
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${s.total} trades | ${s.wr}% WR | PF ${s.pf}`);
  console.log(`  PnL: ${s.totalC >= 0 ? '+' : ''}$${s.totalC} | $2,000 → $${(2000 + s.totalC).toLocaleString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`${'#'.padEnd(4)} ${'Fecha'.padEnd(12)} ${'Hora'.padEnd(9)} ${'Ticker'.padEnd(7)} ${'Entry'.padEnd(10)} ${'SL'.padEnd(10)} ${'TP'.padEnd(10)} ${'Exit'.padEnd(10)} ${'$Cont'.padEnd(8)} ${'PMH'.padEnd(9)} ${'PMR'.padEnd(6)} Res`);
  console.log('─'.repeat(105));
  allTrades.forEach((t, i) => {
    const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
    const res = t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪';
    console.log(`${String(i+1).padEnd(4)} ${t.fecha.padEnd(12)} ${t.hora.padEnd(9)} ${t.ticker.padEnd(7)} $${t.entry.toString().padEnd(9)} $${t.sl.toString().padEnd(9)} $${t.tp.toString().padEnd(9)} $${t.exit.toString().padEnd(9)} ${pnlCStr.padEnd(8)} $${t.pmh.toString().padEnd(8)} $${t.pmRange.toString().padEnd(5)} ${res}`);
  });
  console.log('─'.repeat(105));
  console.log(`Total: ${s.total} trades | ${s.totalC >= 0 ? '+' : ''}$${s.totalC}\n`);

  // Per week
  console.log('── Por Semana ──');
  const weeks = {};
  for (const t of allTrades) {
    const d = new Date(t.fecha);
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay() + 1);
    const wk = ws.toISOString().slice(0, 10);
    if (!weeks[wk]) weeks[wk] = [];
    weeks[wk].push(t);
  }
  let cum = 0;
  for (const [wk, wt] of Object.entries(weeks).sort()) {
    const ws = summarize(wt);
    cum += ws.totalC;
    console.log(`  ${wk}: ${ws.total} trades | ${ws.wr}% WR | ${ws.totalC >= 0 ? '+' : ''}$${ws.totalC} | Acum: ${cum >= 0 ? '+' : ''}$${cum}`);
  }

  // Per ticker
  console.log('\n── Por Ticker ──');
  for (const tk of BEST_TICKERS) {
    const dt = allTrades.filter(t => t.ticker === tk);
    if (dt.length === 0) { console.log(`  ${tk}: Sin trades`); continue; }
    const ts = summarize(dt);
    console.log(`  ${tk.padEnd(6)}: ${ts.total} trades | ${ts.wr}% WR | ${ts.totalC >= 0 ? '+' : ''}$${ts.totalC} | PF ${ts.pf}`);
  }

  // Per day detail
  console.log('\n── Por Dia ──');
  let posDays = 0, negDays = 0;
  for (const d of dates) {
    const dt = allTrades.filter(t => t.fecha === d);
    if (dt.length === 0) continue;
    const dw = dt.filter(t => t.pnl > 0).length;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    if (dp >= 0) posDays++; else negDays++;
    const tickers = dt.map(t => `${t.ticker}(${t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪'})`).join(' ');
    console.log(`  ${d}: ${dt.length} trades | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp} | ${tickers}`);
  }
  console.log(`\n  Dias positivos: ${posDays} | Negativos: ${negDays} | Win days: ${(posDays / (posDays + negDays) * 100).toFixed(0)}%`);

  // Drawdown
  let peak = 0, maxDD = 0, run = 0;
  for (const t of allTrades) { run += t.pnlC; if (run > peak) peak = run; if (peak - run > maxDD) maxDD = peak - run; }
  console.log(`  Max Drawdown: $${maxDD}\n`);

  // VS Live4 comparison
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  LIVE2 vs LIVE4 — 60 dias');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Live2: ${s.total} trades | ${s.wr}% WR | ${s.totalC >= 0 ? '+' : ''}$${s.totalC} | PF ${s.pf}`);
  console.log(`  Live4: 251 trades | 62% WR | +$7,461 | PF 2.65`);
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
