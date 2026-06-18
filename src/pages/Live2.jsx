import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchYahooPrice } from '@/lib/realtimePriceBuffer';
import { analyzeUltraSimple, ultraSimpleScan, checkConvergenceSpxVix } from '@/lib/ultraSimple';

const TICKERS = ['MSFT', 'QQQ', 'NVDA', 'GOOGL'];
const BEST_TICKERS = ['MSFT', 'QQQ', 'NVDA', 'GOOGL'];
const YAHOO_PROXY = '/api/yahoo';
const SL_MAP = { MSFT: 0.75, QQQ: 0.75, NVDA: 0.75, GOOGL: 1.00 };
const TP_MAP = { MSFT: 2.50, QQQ: 2.50, NVDA: 2.50, GOOGL: 3.00 };
const DOLLAR_PER_MOVE = 50; // delta 0.50 × 100 shares

// ── Helpers ──
function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  return et.getHours() * 60 + et.getMinutes() >= 570 && et.getHours() * 60 + et.getMinutes() < 960;
}
function etMinutes() { const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function ts() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

// ── Historical simulation ──
async function fetchSim(ticker, range = '5d') {
  const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=5m&range=${range}&includePrePost=true`);
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}
function getMinET(t) { const d = new Date(t * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }

async function simulateDay(dateStr) {
  const [spx, vix] = await Promise.all([fetchSim('^GSPC', '5d'), fetchSim('^VIX', '5d')]);
  const trades = [];
  function checkConv(dir, targetTs) {
    function ck(data, d, inv) { if (!data) return false; const vi = []; for (let i = 0; i < data.timestamps.length; i++) { if (data.timestamps[i] <= targetTs && data.closes[i] != null) vi.push(i); } if (vi.length < 4) return false; const l4 = vi.slice(-4).map(i => data.closes[i]); const t3 = l4[3] - l4[0], t1 = l4[3] - l4[2]; if (inv) return d === 'CALL' ? (t3 < 0 && t1 <= 0) : (t3 > 0 && t1 >= 0); return d === 'CALL' ? (t3 > 0 && t1 >= 0) : (t3 < 0 && t1 <= 0); }
    return ck(spx, dir, false) && ck(vix, dir, true);
  }
  for (const ticker of BEST_TICKERS) {
    const data = await fetchSim(ticker, '5d'); if (!data) continue;
    const dc = []; for (let i = 0; i < data.timestamps.length; i++) { if (getDateET(data.timestamps[i]) === dateStr) dc.push({ ts: data.timestamps[i], min: getMinET(data.timestamps[i]), o: data.opens[i], h: data.highs[i], l: data.lows[i], c: data.closes[i] }); }
    if (dc.length < 5) continue;
    let pmh = -Infinity, pml = Infinity;
    for (const c of dc) { if (c.min >= 420 && c.min < 570) { if (c.h != null && c.l != null && (c.h - c.l) / c.h > 0.05) continue; if (c.h > pmh) pmh = c.h; if (c.l < pml) pml = c.l; } }
    if (pmh === -Infinity || pmh - pml > 6) continue;
    let orbH = null, orbL = null;
    for (const c of dc) { if (c.min >= 570 && c.min < 575) { orbH = c.h; orbL = c.l; break; } }
    if (!orbH) continue;
    let vN = 0, vD = 0; const vw = {};
    for (const c of dc) { if (c.min >= 570 && c.h && c.l && c.c) { vN += ((c.h + c.l + c.c) / 3); vD++; vw[c.ts] = vD ? vN / vD : null; } }
    const mc = dc.filter(c => c.min >= 575 && c.min < 960);
    let oU = false, pH = false, done = false;
    for (const c of mc) {
      if (c.h > orbH) oU = true; if (c.h > pmh) pH = true;
      if (oU && pH && !done && c.c > pmh && (!vw[c.ts] || c.c > vw[c.ts]) && checkConv('CALL', c.ts)) {
        done = true; const entry = +c.c.toFixed(2), sl = +(entry - (SL_MAP[ticker]||0.75)).toFixed(2), tp = +(entry + (TP_MAP[ticker]||2.50)).toFixed(2);
        let exit = null, res = 'CIERRE';
        for (const f of mc) { if (f.ts <= c.ts) continue; if (f.l <= sl) { exit = sl; res = 'STOP'; break; } if (f.h >= tp) { exit = tp; res = 'TARGET'; break; } }
        if (!exit) { exit = mc[mc.length - 1]?.c || entry; }
        const pnl = +(exit - entry).toFixed(2);
        trades.push({ hora: new Date(c.ts * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }), ticker, dir: 'CALL', entry, sl, tp, exit: +exit.toFixed(2), pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0), resultado: res, pmRange: +(pmh - pml).toFixed(2) });
      }
    }
  }
  return trades;
}

// ── Coach ──
function generateCoach(signal, livePrice, convergence, activeTrade) {
  const now = ts();
  if (activeTrade) {
    const p = livePrice || activeTrade.entry;
    const pnl = activeTrade.direction === 'CALL' ? p - activeTrade.entry : activeTrade.entry - p;
    const pnlC = +(pnl * DOLLAR_PER_MOVE).toFixed(0);
    if (activeTrade.beTriggered) return { time: now, text: `BE activo. PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} ($${pnlC >= 0 ? '+' : ''}${pnlC})`, type: 'go' };
    if (pnl > 0) return { time: now, text: `+$${pnl.toFixed(2)} (+$${pnlC}) — BE en $${activeTrade.beLevel.toFixed(2)}`, type: 'go' };
    return { time: now, text: `$${pnl.toFixed(2)} ($${pnlC}) — SL $${activeTrade.sl.toFixed(2)}`, type: pnl < -0.25 ? 'danger' : 'info' };
  }
  if (!signal) return { time: now, text: 'Cargando...', type: 'info' };
  const s = signal.session?.name;
  if (s === 'CLOSED') return { time: now, text: 'Mercado cerrado', type: 'info' };
  if (s === 'PREMARKET') {
    if (signal.pmh) {
      const r = signal.pmRange || (signal.pmh - signal.pml);
      if (r > 6) return { time: now, text: `PM $${r.toFixed(2)} > $6 — HOY NO SE TRADEA`, type: 'danger' };
      const minsLeft = 570 - etMinutes();
      return { time: now, text: `PMH $${signal.pmh} | PML $${signal.pml} | Rango $${r.toFixed(2)} ${r >= 2 && r <= 5 ? '✅ IDEAL' : ''} | ORB en ${minsLeft > 0 ? minsLeft + 'min' : 'ya'}`, type: r >= 2 && r <= 5 ? 'go' : 'info' };
    }
    return { time: now, text: 'Calculando niveles PM...', type: 'info' };
  }
  if (signal.phase === 'GO' && signal.trade) return { time: now, text: `ENTRAR ${signal.signal} ${signal.ticker} @$${signal.trade.entry} — Riesgo $${(SL_MAP[ticker]||0.75) * DOLLAR_PER_MOVE} Ganancia $${(TP_MAP[ticker]||2.50) * DOLLAR_PER_MOVE}`, type: 'go' };
  if (signal.orbBrokenUp && signal.pmhBroken) return { time: now, text: `ORB+PMH rotos — SPX ${convergence?.spx?.ok ? '✅' : '❌'} VIX ${convergence?.vix?.ok ? '✅' : '❌'}`, type: 'watch' };
  if (signal.orbBrokenUp) return { time: now, text: `ORB roto — falta PMH $${signal.pmh}`, type: 'watch' };
  if (signal.orbH) return { time: now, text: `ORB $${signal.orbL}-$${signal.orbH} | PMH $${signal.pmh || '—'} | Esperando breakout...`, type: 'info' };
  return { time: now, text: `Monitoreando ${signal.ticker}`, type: 'info' };
}

// ═══ COMPONENT ═══
export default function Live2() {
  const [ticker, setTicker] = useState('MSFT');
  const [signal, setSignal] = useState(null);
  const [convergence, setConvergence] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [todayTrades, setTodayTrades] = useState([]);
  const [activeTrade, setActiveTrade] = useState(null);
  const [error, setError] = useState(null);
  const [coachMsg, setCoachMsg] = useState(null);
  const [simDate, setSimDate] = useState(new Date().toISOString().slice(0, 10));
  const [simTrades, setSimTrades] = useState([]);
  const [simLoading, setSimLoading] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const pollRef = useRef(null);
  const [countdown, setCountdown] = useState(0);
  const [marketTime, setMarketTime] = useState('');
  const countdownRef = useRef(null);

  // Market clock + countdown (1s tick)
  useEffect(() => {
    const tick = () => {
      const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      setMarketTime(et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setCountdown(prev => prev > 0 ? prev - 1 : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Price poll 2s
  useEffect(() => {
    let on = true;
    const t = activeTrade?.ticker || ticker;
    const poll = async () => { try { const p = await fetchYahooPrice(t); if (p && on) setLivePrice(p); } catch {} };
    poll();
    const id = setInterval(() => { if (isMarketOpen()) poll(); }, 2000);
    return () => { on = false; clearInterval(id); };
  }, [ticker, activeTrade?.ticker]);

  // Active trade monitor
  useEffect(() => {
    if (!activeTrade || !livePrice) return;
    const { direction, entry, sl, tp, beLevel, beTriggered } = activeTrade;
    if (!beTriggered) {
      if ((direction === 'CALL' && livePrice >= beLevel) || (direction === 'PUT' && livePrice <= beLevel))
        return setActiveTrade(prev => ({ ...prev, sl: entry, beTriggered: true }));
    }
    const curSl = beTriggered ? entry : sl;
    if ((direction === 'CALL' && livePrice <= curSl) || (direction === 'PUT' && livePrice >= curSl)) { setActiveTrade(null); return; }
    if ((direction === 'CALL' && livePrice >= tp) || (direction === 'PUT' && livePrice <= tp)) { setActiveTrade(null); return; }
  }, [livePrice, activeTrade]);

  // FAST BREAKOUT DETECTION — uses live price (2s) to detect PMH break instantly
  const [fastBreakout, setFastBreakout] = useState(null);
  useEffect(() => {
    if (!livePrice || !signal || activeTrade || !isMarketOpen()) return;
    if (!BEST_TICKERS.includes(ticker)) return;
    if (signal.dayTrend === 'DOWN') return;
    const pmh = signal.pmh, orbH = signal.orbH;
    if (!pmh || !orbH) return;
    if ((signal.pmRange || 0) > 6) return;

    const orbBroke = livePrice > orbH || signal.orbBrokenUp;
    const pmhBroke = livePrice > pmh || signal.pmhBroken;
    const vwapOk = !signal.vwap || livePrice > signal.vwap;

    if (orbBroke && pmhBroke && vwapOk && !fastBreakout) {
      const SL = SL_MAP[ticker] || 0.75;
      const TP = TP_MAP[ticker] || 2.50;
      setFastBreakout({
        ticker, price: livePrice, pmh, orbH,
        entry: +livePrice.toFixed(2),
        sl: +(livePrice - SL).toFixed(2),
        tp: +(livePrice + TP).toFixed(2),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        slDollars: +(SL * DOLLAR_PER_MOVE).toFixed(0),
        tpDollars: +(TP * DOLLAR_PER_MOVE).toFixed(0),
      });
    } else if (fastBreakout && livePrice < pmh - 0.10) {
      // Price fell back below PMH with margin — false breakout
      setFastBreakout(null);
    }
  }, [livePrice, signal, activeTrade, ticker]);

  // AUTO-ENTRY: when fast breakout detected + convergence confirms → enter immediately
  useEffect(() => {
    if (!fastBreakout || !convergence?.converging || activeTrade) return;
    const SL = SL_MAP[fastBreakout.ticker] || 0.75;
    const TP = TP_MAP[fastBreakout.ticker] || 2.50;
    const entry = +(livePrice || fastBreakout.price).toFixed(2);
    setActiveTrade({
      ticker: fastBreakout.ticker, direction: 'CALL',
      entry, sl: +(entry - SL).toFixed(2), tp: +(entry + TP).toFixed(2),
      beLevel: +(entry + SL).toFixed(2), risk: SL,
      beTriggered: false, startTime: new Date().toISOString(), dbId: null,
    });
    setCoachMsg({ time: ts(), text: `ENTRAR CALL ${fastBreakout.ticker} @$${entry} — Riesgo $${(SL * DOLLAR_PER_MOVE).toFixed(0)} Ganancia $${(TP * DOLLAR_PER_MOVE).toFixed(0)}`, type: 'go' });
    setTicker(fastBreakout.ticker);
    setFastBreakout(null);
  }, [fastBreakout, convergence?.converging, activeTrade]);

  // Convergence poll 3s
  useEffect(() => {
    let on = true;
    const dir = activeTrade?.direction || signal?.signal || 'CALL';
    const poll = async () => { try { const c = await checkConvergenceSpxVix(dir); if (on) setConvergence(c); } catch {} };
    poll();
    const id = setInterval(() => { if (isMarketOpen()) poll(); }, 3000);
    return () => { on = false; clearInterval(id); };
  }, [signal?.signal, ticker, activeTrade?.direction]);

  // Load trades
  async function loadTrades() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/db/trades?limit=50'); const data = await res.json();
      if (data.ok) setTodayTrades((data.data || []).filter(t => t.session === today || t.opened_at?.startsWith(today)));
    } catch {}
  }

  // Main data poll
  const loadData = useCallback(async () => {
    try {
      const [sig, scan] = await Promise.all([analyzeUltraSimple(ticker), ultraSimpleScan(TICKERS)]);
      setSignal(sig); setScanResult(scan); setError(null);
      setCoachMsg(generateCoach(sig, livePrice, convergence, activeTrade));

      // Backup: 5min analysis also triggers entry (in case fast detection missed it)
      if (!activeTrade && !fastBreakout && sig?.phase === 'GO' && sig?.trade && sig?.convergence?.converging) {
        const trade = sig.trade, details = sig.details;
        const today = new Date().toISOString().slice(0, 10);
        let dbId = null;
        try { const r = await fetch('/api/db/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: sig.ticker, signal: details.direction, entry: trade.entry, sl: trade.stop, tp: trade.target, score: 8, setupGrade: 'A', volumeZone: details?.level || '', session: today }) }); const d = await r.json(); dbId = d?.data?.id; } catch {}
        setTicker(sig.ticker);
        setActiveTrade({ ticker: sig.ticker, direction: details.direction, entry: trade.entry, sl: trade.stop, tp: trade.target, beLevel: trade.beLevel, risk: trade.risk, beTriggered: false, startTime: new Date().toISOString(), dbId });
      }
      await loadTrades();
      const broken = signal?.orbBrokenUp && signal?.pmhBroken;
      const secs = activeTrade ? 5 : broken ? 5 : 30;
      setCountdown(secs);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (e) { setError('Error cargando datos'); }
  }, [ticker, activeTrade, livePrice, convergence]);

  // Auto-reload when countdown hits 0
  useEffect(() => {
    if (countdown === 0 && signal) { if (isMarketOpen()) loadData(); }
  }, [countdown]);

  // Initial load
  useEffect(() => { loadData(); }, [ticker, !!activeTrade]);

  // Sim
  const runSim = async () => { setSimLoading(true); try { setSimTrades(await simulateDay(simDate)); } catch {} setSimLoading(false); };

  // ── Derived state ──
  const price = livePrice || signal?.price || 0;
  const pmh = signal?.pmh, pml = signal?.pml, orbH = signal?.orbH, orbL = signal?.orbL;
  const vwapVal = signal?.vwap;
  const checks = [
    { label: 'ORB High roto', done: !!signal?.orbBrokenUp, value: orbH ? `$${orbH}` : '—' },
    { label: 'PMH roto', done: !!signal?.pmhBroken, value: pmh ? `$${pmh}` : '—' },
    { label: 'Precio > VWAP', done: vwapVal ? price > vwapVal : false, value: vwapVal ? `$${vwapVal}` : '—' },
    { label: 'SPY subiendo', done: !!convergence?.spx?.ok, value: convergence?.spx?.trend3 != null ? `${convergence.spx.trend3 > 0 ? '+' : ''}${convergence.spx.trend3}` : '—' },
    { label: 'VIX bajando', done: !!convergence?.vix?.ok, value: convergence?.vix?.trend3 != null ? `${convergence.vix.trend3 > 0 ? '+' : ''}${convergence.vix.trend3}` : '—' },
  ];
  const done = checks.filter(c => c.done).length;
  const session = signal?.session?.name;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-lg mx-auto px-3 py-4 space-y-4">

        {/* ERROR */}
        {error && <div className="rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm text-red-300 text-center">{error} <button onClick={loadData} className="underline ml-2">Reintentar</button></div>}

        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {TICKERS.map(t => {
              const hasSig = scanResult?.signals?.find(s => s.ticker === t);
              const isBest = BEST_TICKERS.includes(t);
              const isAct = activeTrade?.ticker === t;
              return (
                <button key={t} onClick={() => !activeTrade && setTicker(t)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${isAct ? 'bg-green-500 text-black' : hasSig ? 'bg-green-500/30 text-green-400 ring-2 ring-green-400' : ticker === t ? 'bg-white text-black' : 'bg-white/5 text-white/40'} ${isBest ? 'ring-1 ring-yellow-500/40' : ''}`}>
                  {t}{isBest ? ' ★' : ''}
                </button>
              );
            })}
          </div>
          <div className="text-right">
            <div className="text-3xl font-black font-mono">${price ? price.toFixed(2) : '—'}</div>
            <div className="text-[10px] text-white/30">
              {signal?.dayTrend === 'UP' ? '↑ Alcista' : signal?.dayTrend === 'DOWN' ? '↓ Bajista' : '→ Neutral'}
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/20">
              <span className="font-mono">{marketTime}</span>
              <span>ET</span>
              <span className={`font-mono font-bold ${countdown <= 3 ? 'text-yellow-400' : 'text-white/30'}`}>{countdown}s</span>
              <div className="w-8 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400 transition-all duration-1000" style={{ width: `${(countdown / (activeTrade ? 5 : 30)) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* FAST BREAKOUT ALERT — detected via live price before 5min analysis */}
        {fastBreakout && !activeTrade && convergence?.converging && (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-green-500/30 to-yellow-500/20 border-2 border-green-400 animate-pulse">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-green-300 uppercase tracking-widest font-bold">Breakout detectado — {fastBreakout.time}</div>
                <div className="text-2xl font-black text-green-400">{fastBreakout.ticker} CALL ${fastBreakout.entry}</div>
              </div>
              <div className="text-right text-sm">
                <div className="text-red-300">SL ${fastBreakout.sl} <span className="text-red-400/60">(-${fastBreakout.slDollars})</span></div>
                <div className="text-green-300">TP ${fastBreakout.tp} <span className="text-green-400/60">(+${fastBreakout.tpDollars})</span></div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-white/40">Rompió PMH ${fastBreakout.pmh} + ORB ${fastBreakout.orbH} · SPY ✅ VIX ✅ · Esperando confirmación 1min...</div>
          </div>
        )}

        {/* ═══ HERO CARD ═══ */}
        {activeTrade ? (() => {
          const pnl = activeTrade.direction === 'CALL' ? (livePrice || activeTrade.entry) - activeTrade.entry : activeTrade.entry - (livePrice || activeTrade.entry);
          const pnlC = +(pnl * DOLLAR_PER_MOVE).toFixed(0);
          const sl = activeTrade.beTriggered ? activeTrade.entry : activeTrade.sl;
          const range = Math.abs(activeTrade.tp - activeTrade.sl);
          const pct = Math.max(0, Math.min(100, activeTrade.direction === 'CALL' ? ((livePrice - activeTrade.sl) / range) * 100 : ((activeTrade.sl - livePrice) / range) * 100));
          return (
            <div className={`rounded-3xl p-6 ${pnl >= 0 ? 'bg-gradient-to-b from-green-500/20 to-green-500/5 border-2 border-green-500/40' : 'bg-gradient-to-b from-red-500/20 to-red-500/5 border-2 border-red-500/40'}`}>
              <div className="text-center">
                <div className="text-[11px] text-white/40 uppercase tracking-widest mb-1">{activeTrade.direction} {activeTrade.ticker} · Trade Activo</div>
                <div className={`text-6xl font-black font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnlC >= 0 ? '+' : ''}${pnlC}</div>
                <div className="text-sm text-white/50 mt-1">Stock: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} · {activeTrade.beTriggered ? 'BE Activo ✅' : `BE en $${activeTrade.beLevel.toFixed(2)}`}</div>
              </div>
              <div className="mt-5 h-3 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, #ef4444, #f59e0b, #3b82f6, #22c55e)`, backgroundSize: '400%', backgroundPosition: `${100 - pct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-white/30 mt-1 font-mono">
                <span className="text-red-400">SL ${sl.toFixed(2)}</span>
                <span>Entry ${activeTrade.entry.toFixed(2)}</span>
                <span className="text-green-400">TP ${activeTrade.tp.toFixed(2)}</span>
              </div>
            </div>
          );
        })()

        : signal?.phase === 'GO' && signal?.trade ? (
          <div className="rounded-3xl p-8 bg-gradient-to-b from-green-500/30 to-green-500/5 border-4 border-green-400 animate-pulse text-center">
            <div className="text-7xl mb-3">🟢</div>
            <div className="text-4xl font-black text-green-400">{signal.details?.direction === 'CALL' ? 'COMPRA' : 'VENDE'}</div>
            <div className="text-2xl font-black text-white mt-1">{signal.ticker} ${signal.trade.entry}</div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-red-500/20 p-4 text-center">
                <div className="text-[10px] text-red-300 mb-1">Si baja aqui → SALIR</div>
                <div className="text-xl font-black text-red-400 font-mono">${signal.trade.stop}</div>
                <div className="text-[10px] text-red-300/50 mt-1">Pierdes $20</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-4 text-center">
                <div className="text-[10px] text-white/40 mb-1">Comprar aqui</div>
                <div className="text-xl font-black text-white font-mono">${signal.trade.entry}</div>
              </div>
              <div className="rounded-2xl bg-green-500/20 p-4 text-center">
                <div className="text-[10px] text-green-300 mb-1">Si sube aqui → GANAR</div>
                <div className="text-xl font-black text-green-400 font-mono">${signal.trade.target}</div>
                <div className="text-[10px] text-green-300/50 mt-1">Ganas $100</div>
              </div>
            </div>
          </div>
        )

        : (
          <div className={`rounded-3xl p-6 border-2 ${done >= 5 ? 'border-green-400 bg-green-500/10 animate-pulse' : done >= 3 ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
            {/* State icon */}
            <div className="text-center mb-4">
              <div className="text-5xl">{done >= 5 ? '🟢' : done >= 3 ? '🟡' : '🔴'}</div>
              <div className={`text-xl font-black mt-1 ${done >= 5 ? 'text-green-400' : done >= 3 ? 'text-yellow-300' : 'text-white/30'}`}>
                {done >= 5 ? 'ENTRAR AHORA' : done >= 3 ? 'PREPARARSE' : session === 'PREMARKET' ? 'PREMARKET' : 'ESPERANDO'}
              </div>
              <div className="text-sm text-white font-mono">{ticker} ${price ? price.toFixed(2) : '—'}</div>
            </div>

            {/* Premarket plan */}
            {session === 'PREMARKET' && pmh && (
              <div className="mb-4 rounded-2xl bg-white/5 p-4 text-center border border-white/10">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div><div className="text-[9px] text-green-300">PMH</div><div className="text-xl font-black font-mono text-green-400">${pmh}</div></div>
                  <div><div className="text-[9px] text-red-300">PML</div><div className="text-xl font-black font-mono text-red-400">${pml}</div></div>
                </div>
                <div className="text-[10px] text-white/40 mb-2">Si rompe PMH → CALL</div>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div><span className="text-white/30">Entry</span> <span className="text-white">${pmh}</span></div>
                  <div><span className="text-red-300">SL</span> <span className="text-red-400">${(pmh - (SL_MAP[ticker]||0.75)).toFixed(2)}</span></div>
                  <div><span className="text-green-300">TP</span> <span className="text-green-400">${(pmh + (TP_MAP[ticker]||2.50)).toFixed(2)}</span></div>
                </div>
                <div className="text-[10px] text-white/30 mt-2">Riesgo $20 → Ganancia $100</div>
              </div>
            )}

            {/* Entry preview — siempre visible */}
            {pmh && (
              <div className={`mb-4 rounded-2xl overflow-hidden border ${done >= 3 ? 'border-yellow-500/30' : 'border-white/10'}`}>
                <div className={`px-4 py-2 text-center text-[10px] uppercase tracking-widest font-bold ${done >= 3 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-white/5 text-white/30'}`}>
                  {done >= 5 ? 'Entrada lista' : done >= 3 ? 'Posible entrada' : 'Plan del dia'} — {ticker}
                </div>
                <div className="p-4 bg-black/30">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-red-500/15 p-3">
                      <div className="text-[9px] text-red-300 mb-1">Stop Loss</div>
                      <div className="text-lg font-black text-red-400 font-mono">${(pmh - (SL_MAP[ticker]||0.75)).toFixed(2)}</div>
                      <div className="text-[10px] text-red-300/60 mt-1">Pierdes $20</div>
                    </div>
                    <div className={`rounded-xl p-3 ${done >= 3 ? 'bg-yellow-500/15' : 'bg-white/10'}`}>
                      <div className="text-[9px] text-white/40 mb-1">Entrada</div>
                      <div className="text-lg font-black text-white font-mono">${pmh}</div>
                      <div className="text-[10px] text-white/30 mt-1">En PMH</div>
                    </div>
                    <div className="rounded-xl bg-green-500/15 p-3">
                      <div className="text-[9px] text-green-300 mb-1">Take Profit</div>
                      <div className="text-lg font-black text-green-400 font-mono">${(pmh + (TP_MAP[ticker]||2.50)).toFixed(2)}</div>
                      <div className="text-[10px] text-green-300/60 mt-1">Ganas $100</div>
                    </div>
                  </div>
                  {livePrice && pmh && (
                    <div className="mt-3 text-center">
                      <div className="text-[10px] text-white/30">Distancia al PMH</div>
                      <div className={`text-lg font-bold font-mono ${Math.abs(price - pmh) < 1 ? 'text-yellow-400' : 'text-white/40'}`}>
                        ${(price - pmh).toFixed(2)} {price > pmh ? '(arriba)' : '(abajo)'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Checklist */}
            <div className="space-y-2">
              {checks.map((c, i) => (
                <div key={i} className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${c.done ? 'bg-green-500/10 border border-green-500/20' : 'bg-white/[0.03] border border-white/5'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{c.done ? '✅' : '⬜'}</span>
                    <span className={`text-sm ${c.done ? 'text-green-400 font-bold' : 'text-white/30'}`}>{c.label}</span>
                  </div>
                  <span className={`font-mono text-sm ${c.done ? 'text-green-400' : 'text-white/15'}`}>{c.value}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(done / 5) * 100}%`, background: done >= 5 ? '#22c55e' : done >= 3 ? '#eab308' : '#555' }} />
                </div>
                <span className="text-xs text-white/30 font-mono">{done}/5</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ COACH ═══ */}
        {coachMsg && (
          <div className={`rounded-xl px-4 py-3 border text-sm ${coachMsg.type === 'go' ? 'bg-green-500/15 border-green-500/30 text-green-300' : coachMsg.type === 'watch' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' : coachMsg.type === 'danger' ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-white/5 border-white/10 text-white/60'}`}>
            <span className="text-[9px] opacity-40 mr-2 font-mono">{coachMsg.time}</span>
            {coachMsg.type === 'go' ? '🟢 ' : coachMsg.type === 'watch' ? '🟡 ' : coachMsg.type === 'danger' ? '🔴 ' : ''}
            {coachMsg.text}
          </div>
        )}

        {/* ═══ TICKERS ═══ */}
        <div className="grid grid-cols-3 gap-2">
          {TICKERS.map(t => {
            const item = scanResult?.signals?.find(s => s.ticker === t) || scanResult?.watching?.find(s => s.ticker === t) || scanResult?.noSignal?.find(s => s.ticker === t);
            const p = item?.price || 0;
            const hasSig = !!scanResult?.signals?.find(s => s.ticker === t);
            const blocked = (item?.pmRange || 0) > 6;
            return (
              <button key={t} onClick={() => !activeTrade && setTicker(t)}
                className={`rounded-2xl p-3 text-center transition-all ${hasSig ? 'bg-green-500/20 border-2 border-green-400 animate-pulse' : blocked ? 'bg-red-500/5 border border-red-500/15' : ticker === t ? 'bg-white/10 border border-white/15' : 'bg-white/[0.03] border border-white/5'}`}>
                <div className={`text-xs font-black ${hasSig ? 'text-green-400' : 'text-white/70'}`}>{t}{BEST_TICKERS.includes(t) ? ' ★' : ''}</div>
                <div className="text-base font-bold font-mono text-white">${p ? p.toFixed(0) : '—'}</div>
                {hasSig && <div className="text-[10px] text-green-400 font-bold">ENTRAR</div>}
                {blocked && <div className="text-[9px] text-red-400">PM &gt;$6</div>}
                {!hasSig && !blocked && <div className="text-[9px] text-white/15">{item?.orbBrokenUp ? 'ORB✅' : '—'} {item?.pmhBroken ? 'PMH✅' : ''}</div>}
              </button>
            );
          })}
        </div>

        {/* ═══ SIM (collapsible) ═══ */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <button onClick={() => setSimOpen(!simOpen)} className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5">
            <span className="text-xs uppercase tracking-widest text-white/30 font-bold">Simulacion Historica</span>
            <span className="text-white/20">{simOpen ? '▲' : '▼'}</span>
          </button>
          {simOpen && (
            <div className="px-4 pb-4 space-y-3">
              <div className="flex gap-2">
                <input type="date" value={simDate} onChange={e => setSimDate(e.target.value)} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-mono" />
                <button onClick={runSim} disabled={simLoading} className="px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-bold hover:bg-white/20">{simLoading ? '...' : 'Simular'}</button>
              </div>
              {simTrades.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-white/30 border-b border-white/10">
                      <th className="text-left py-1.5">Hora</th><th className="text-left">Ticker</th><th className="text-right">Entry</th><th className="text-right">SL</th><th className="text-right">TP</th><th className="text-right">PnL</th><th className="text-right">$Cont</th><th className="text-center">Res</th>
                    </tr></thead>
                    <tbody>{simTrades.map((t, i) => (
                      <tr key={i} className={t.pnl > 0 ? 'bg-green-500/5' : t.pnl < 0 ? 'bg-red-500/5' : ''}>
                        <td className="py-1.5 text-white/40 font-mono">{t.hora}</td>
                        <td className="font-bold">{t.ticker}</td>
                        <td className="text-right font-mono">${t.entry}</td>
                        <td className="text-right font-mono text-red-400">${t.sl}</td>
                        <td className="text-right font-mono text-green-400">${t.tp}</td>
                        <td className={`text-right font-mono font-bold ${t.pnl > 0 ? 'text-green-400' : t.pnl < 0 ? 'text-red-400' : ''}`}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</td>
                        <td className={`text-right font-mono font-bold ${t.pnlC > 0 ? 'text-green-400' : t.pnlC < 0 ? 'text-red-400' : ''}`}>{t.pnlC >= 0 ? '+' : ''}${t.pnlC}</td>
                        <td className="text-center">{t.resultado === 'TARGET' ? '✅' : t.resultado === 'STOP' ? '❌' : '⚪'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <div className="text-center text-xs mt-2">
                    <span className={`font-bold font-mono ${simTrades.reduce((s, t) => s + t.pnlC, 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      Total: {simTrades.reduce((s, t) => s + t.pnlC, 0) >= 0 ? '+' : ''}${simTrades.reduce((s, t) => s + t.pnlC, 0)}
                    </span>
                  </div>
                </div>
              )}
              {simTrades.length === 0 && !simLoading && <div className="text-center text-white/20 text-xs py-3">Sin trades para esa fecha</div>}
            </div>
          )}
        </div>

        {/* ═══ TRADES HOY ═══ */}
        {todayTrades.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs uppercase tracking-widest text-white/30 font-bold mb-3">Trades Hoy ({todayTrades.length})</div>
            <div className="space-y-2">
              {todayTrades.map((t, i) => {
                const entry = parseFloat(t.entry), exit = t.exit_price ? parseFloat(t.exit_price) : null;
                const pnl = exit ? (t.signal === 'CALL' ? exit - entry : entry - exit) : null;
                const pnlC = pnl ? +(pnl * DOLLAR_PER_MOVE).toFixed(0) : null;
                return (
                  <div key={i} className={`flex items-center justify-between rounded-xl px-3 py-2 ${pnl && pnl > 0 ? 'bg-green-500/5' : pnl && pnl < 0 ? 'bg-red-500/5' : 'bg-white/[0.02]'} border border-white/5`}>
                    <div className="flex items-center gap-2">
                      <span>{!exit ? '🔵' : pnl > 0 ? '✅' : '❌'}</span>
                      <span className="text-xs font-bold">{t.ticker}</span>
                      <span className={`text-xs ${t.signal === 'CALL' ? 'text-green-400' : 'text-red-400'}`}>{t.signal}</span>
                      <span className="text-[10px] text-white/30 font-mono">${entry.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      {pnlC != null ? (
                        <span className={`text-sm font-bold font-mono ${pnlC >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnlC >= 0 ? '+' : ''}${pnlC}</span>
                      ) : (
                        <span className="text-xs text-blue-400">Abierto</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
