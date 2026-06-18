// Backtest Live2 (ORB+PMH) — Last 5 trading days with real Yahoo data
// Same logic as ultraSimple.js: ORB first 5min + PMH from 7:00-9:30 + SPY/VIX convergence + VWAP
const BEST_TICKERS = ['MSFT', 'QQQ', 'NVDA', 'GOOGL'];
const SL_MAP = { MSFT: 0.75, QQQ: 0.75, NVDA: 0.75, GOOGL: 1.00 };
const TP_MAP = { MSFT: 2.50, QQQ: 2.50, NVDA: 2.50, GOOGL: 3.00 };
const DOLLAR_PER_MOVE = 50;

async function fetchYahoo(ticker, interval = '5m', range = '5d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}

function getMinET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000); const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }

async function simulateDay(dateStr) {
  const [spyD, vixD] = await Promise.all([fetchYahoo('^GSPC', '5m', '5d'), fetchYahoo('^VIX', '5m', '5d')]);
  const trades = [];

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

  for (const ticker of BEST_TICKERS) {
    const data = await fetchYahoo(ticker, '5m', '5d');
    if (!data) continue;

    const dc = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      if (getDateET(data.timestamps[i]) === dateStr)
        dc.push({ ts: data.timestamps[i], min: getMinET(data.timestamps[i]), o: data.opens[i], h: data.highs[i], l: data.lows[i], c: data.closes[i] });
    }
    if (dc.length < 5) continue;

    // PMH/PML from 7:00-9:30 (min 420-570)
    let pmh = -Infinity, pml = Infinity;
    for (const c of dc) {
      if (c.min >= 420 && c.min < 570) {
        if (c.h != null && c.l != null && (c.h - c.l) / c.h > 0.05) continue; // glitch filter
        if (c.h > pmh) pmh = c.h;
        if (c.l < pml) pml = c.l;
      }
    }
    if (pmh === -Infinity || pmh - pml > 6) continue;

    // ORB first 5min candle (9:30-9:35)
    let orbH = null, orbL = null;
    for (const c of dc) { if (c.min >= 570 && c.min < 575) { orbH = c.h; orbL = c.l; break; } }
    if (!orbH) continue;

    // VWAP
    let vN = 0, vD = 0; const vw = {};
    for (const c of dc) {
      if (c.min >= 570 && c.h && c.l && c.c) { vN += ((c.h + c.l + c.c) / 3); vD++; vw[c.ts] = vD ? vN / vD : null; }
    }

    // Walk market candles
    const mc = dc.filter(c => c.min >= 575 && c.min < 960);
    let oU = false, pH = false, done = false;

    for (const c of mc) {
      if (c.h > orbH) oU = true;
      if (c.h > pmh) pH = true;

      if (oU && pH && !done && c.c > pmh && (!vw[c.ts] || c.c > vw[c.ts]) && checkConv('CALL', c.ts)) {
        done = true;
        const entry = +c.c.toFixed(2);
        const sl = +(entry - (SL_MAP[ticker] || 0.75)).toFixed(2);
        const tp = +(entry + (TP_MAP[ticker] || 2.50)).toFixed(2);
        const slDollars = +((SL_MAP[ticker] || 0.75) * DOLLAR_PER_MOVE).toFixed(0);
        const tpDollars = +((TP_MAP[ticker] || 2.50) * DOLLAR_PER_MOVE).toFixed(0);

        let exit = null, res = 'CIERRE';
        for (const f of mc) {
          if (f.ts <= c.ts) continue;
          if (f.l <= sl) { exit = sl; res = 'STOP'; break; }
          if (f.h >= tp) { exit = tp; res = 'TARGET'; break; }
        }
        if (!exit) { exit = mc[mc.length - 1]?.c || entry; }

        const pnl = +(exit - entry).toFixed(2);
        const hora = new Date(c.ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

        trades.push({
          fecha: dateStr, hora, ticker, dir: 'CALL', entry, sl, tp,
          exit: +exit.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0),
          resultado: res, pmh: +pmh.toFixed(2), pml: +pml.toFixed(2),
          pmRange: +(pmh - pml).toFixed(2), orbH: +orbH.toFixed(2), orbL: +orbL.toFixed(2),
          slDollars, tpDollars,
        });
      }
    }
  }
  return trades;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BACKTEST LIVE2 (ORB+PMH) — Ultima semana');
  console.log('  Tickers: MSFT, QQQ, NVDA, GOOGL | Delta $50/move');
  console.log('  SL: MSFT/QQQ/NVDA $0.75 | GOOGL $1.00');
  console.log('  TP: MSFT/QQQ/NVDA $2.50 | GOOGL $3.00');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Fetching Yahoo data...\n');

  // Get dates from QQQ
  const probe = await fetchYahoo('QQQ', '5m', '5d');
  if (!probe) { console.log('No data'); return; }
  const dates = [...new Set(probe.timestamps.map(t => getDateET(t)))].sort();
  console.log(`Dias: ${dates.join(', ')}\n`);

  const allTrades = [];
  for (const d of dates) {
    const dt = await simulateDay(d);
    allTrades.push(...dt);
  }

  if (allTrades.length === 0) {
    console.log('❌ No trades encontrados.\n');
    return;
  }

  // Print all trades
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TODAS LAS ENTRADAS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${'#'.padEnd(4)} ${'Fecha'.padEnd(12)} ${'Hora RD'.padEnd(10)} ${'Ticker'.padEnd(7)} ${'Dir'.padEnd(5)} ${'Entry'.padEnd(10)} ${'SL'.padEnd(10)} ${'TP'.padEnd(10)} ${'Exit'.padEnd(10)} ${'$Cont'.padEnd(8)} ${'PMH'.padEnd(9)} ${'ORB H'.padEnd(9)} Res`);
  console.log('─'.repeat(110));

  allTrades.forEach((t, i) => {
    const pnlCStr = (t.pnlC >= 0 ? '+' : '') + '$' + t.pnlC;
    const res = t.resultado === 'TARGET' ? '✅ TARGET' : t.resultado === 'STOP' ? '❌ STOP' : '⚪ CIERRE';
    console.log(`${String(i+1).padEnd(4)} ${t.fecha.padEnd(12)} ${t.hora.padEnd(10)} ${t.ticker.padEnd(7)} ${t.dir.padEnd(5)} $${t.entry.toString().padEnd(9)} $${t.sl.toString().padEnd(9)} $${t.tp.toString().padEnd(9)} $${t.exit.toString().padEnd(9)} ${pnlCStr.padEnd(8)} $${t.pmh.toString().padEnd(8)} $${t.orbH.toString().padEnd(8)} ${res}`);
  });

  // Summary
  const wins = allTrades.filter(t => t.pnl > 0);
  const losses = allTrades.filter(t => t.pnl < 0);
  const totalC = allTrades.reduce((s, t) => s + t.pnlC, 0);
  const wr = allTrades.length ? (wins.length / allTrades.length * 100).toFixed(0) : 0;
  const avgW = wins.length ? (wins.reduce((s, t) => s + t.pnlC, 0) / wins.length).toFixed(0) : 0;
  const avgL = losses.length ? (losses.reduce((s, t) => s + t.pnlC, 0) / losses.length).toFixed(0) : 0;
  const pf = losses.length && losses.reduce((s, t) => s + t.pnlC, 0) !== 0 ? Math.abs(wins.reduce((s, t) => s + t.pnlC, 0) / losses.reduce((s, t) => s + t.pnlC, 0)).toFixed(2) : '∞';

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Trades:     ${allTrades.length}`);
  console.log(`  Wins:       ${wins.length} (${wr}%)`);
  console.log(`  Losses:     ${losses.length}`);
  console.log(`  PnL:        ${totalC >= 0 ? '+' : ''}$${totalC}`);
  console.log(`  Avg Win:    +$${avgW}`);
  console.log(`  Avg Loss:   $${avgL}`);
  console.log(`  PF:         ${pf}`);
  console.log(`  Cuenta:     $2,000 → $${(2000 + totalC).toLocaleString()}`);

  console.log('\n── Por Dia ──');
  for (const d of dates) {
    const dt = allTrades.filter(t => t.fecha === d);
    if (dt.length === 0) { console.log(`  ${d}: Sin trades`); continue; }
    const dw = dt.filter(t => t.pnl > 0).length;
    const dp = dt.reduce((s, t) => s + t.pnlC, 0);
    const tickers = dt.map(t => `${t.ticker}(${t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪'})`).join(' ');
    console.log(`  ${d}: ${dt.length} trades | ${dw}W ${dt.length - dw}L | ${dp >= 0 ? '+' : ''}$${dp} | ${tickers}`);
  }

  console.log('\n── Por Ticker ──');
  for (const tk of BEST_TICKERS) {
    const dt = allTrades.filter(t => t.ticker === tk);
    if (dt.length === 0) { console.log(`  ${tk}: Sin trades`); continue; }
    const s = { wins: dt.filter(t => t.pnl > 0).length, total: dt.length, pnl: dt.reduce((s, t) => s + t.pnlC, 0) };
    console.log(`  ${tk.padEnd(6)}: ${s.total} trades | ${Math.round(s.wins/s.total*100)}% WR | ${s.pnl >= 0 ? '+' : ''}$${s.pnl}`);
  }
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
