import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchYahooPrice } from '@/lib/realtimePriceBuffer';
import { analyzeSmartMoney, smartMoneyScan } from '@/lib/smartMoneyEngine';

const TICKERS = ['QQQ', 'SPY', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMD'];
const DOLLAR_PER_MOVE = 50; // delta 0.50
const YAHOO_PROXY = '/api/yahoo';

function ts() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function isMarketOpen() { const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes(); return d > 0 && d < 6 && m >= 570 && m < 960; }
function etMinutes() { const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }

const REGIME_COLORS = { TREND: 'text-emerald-300', CHOP: 'text-red-300', RANGE: 'text-amber-300', UNKNOWN: 'text-muted-foreground' };
const REGIME_ICONS = { TREND: 'TREND', CHOP: 'CHOP', RANGE: 'RANGE', UNKNOWN: '—' };
const KZ_LABELS = { MORNING: 'Morning KZ', POWER_HOUR: 'Power Hour', MIDDAY: 'Midday', REGULAR: 'Regular', OUTSIDE: 'Fuera', PREMARKET: 'Premarket', CLOSED: 'Cerrado', CLOSE: 'Cierre' };

// ── Backtest helpers ──
async function fetchHist(ticker, range = '5d') {
  const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=1m&range=${range}&includePrePost=true`);
  const data = await res.json(); const r = data?.chart?.result?.[0]; if (!r) return null;
  const q = r.indicators?.quote?.[0] || {};
  return { timestamps: r.timestamp || [], opens: q.open || [], highs: q.high || [], lows: q.low || [], closes: q.close || [], volumes: q.volume || [] };
}
function getMinET(t) { const d = new Date(t * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.getHours() * 60 + et.getMinutes(); }
function getDateET(t) { const d = new Date(t * 1000), et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })); return et.toISOString().slice(0, 10); }

// Inline mini-indicators for backtest (avoid importing engine internals)
function miniEMA(a, p) { if (!a || a.length < p) return []; const k = 2 / (p + 1); const e = [a[0]]; for (let i = 1; i < a.length; i++) e.push(a[i] != null ? a[i] * k + e[i - 1] * (1 - k) : e[i - 1]); return e; }
function miniVWAP(h, l, c, v) { const vw = []; let n = 0, d = 0; for (let i = 0; i < c.length; i++) { if (h[i] != null && l[i] != null && c[i] != null && v[i] != null) { n += ((h[i] + l[i] + c[i]) / 3) * v[i]; d += v[i]; } vw.push(d ? +(n / d).toFixed(2) : null); } return vw; }

function detectSwingLevels(h, l, start, end) {
  const levels = [];
  for (let i = Math.max(start + 1, 2); i < end - 1; i++) {
    if (h[i] != null && h[i - 1] != null && h[i + 1] != null && h[i] > h[i - 1] && h[i] > h[i + 1]) levels.push({ type: 'HIGH', price: h[i], idx: i });
    if (l[i] != null && l[i - 1] != null && l[i + 1] != null && l[i] < l[i - 1] && l[i] < l[i + 1]) levels.push({ type: 'LOW', price: l[i], idx: i });
  }
  return levels;
}

async function backtestSmartMoney(dateStr) {
  const trades = [];
  const [spyD, vixD] = await Promise.all([
    fetchHist('SPY', '5d'), fetchHist('^VIX', '5d'),
  ]);

  for (const ticker of TICKERS) {
    const data = await fetchHist(ticker, '5d');
    if (!data) continue;

    // Filter to target date, regular hours only (9:35 - 15:55 ET)
    const dayCandles = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      if (getDateET(data.timestamps[i]) !== dateStr) continue;
      const m = getMinET(data.timestamps[i]);
      if (m >= 575 && m < 955) dayCandles.push(i);
    }
    if (dayCandles.length < 30) continue;

    const dc = dayCandles;
    const h = data.highs, l = data.lows, o = data.opens, c = data.closes, v = data.volumes;

    // Calculate VWAP for the day
    const dH = dc.map(i => h[i]), dL = dc.map(i => l[i]), dC = dc.map(i => c[i]), dV = dc.map(i => v[i]), dO = dc.map(i => o[i]);
    const vwap = miniVWAP(dH, dL, dC, dV);
    const ema9 = miniEMA(dC, 9), ema21 = miniEMA(dC, 21);

    let inTrade = false;

    // Walk candles looking for sweep → MSS setups
    for (let j = 20; j < dc.length - 5; j++) {
      if (inTrade) continue;
      const idx = j;
      const price = dC[idx];
      if (!price) continue;

      // Check bias
      const vwapNow = vwap[idx];
      const e9 = ema9[idx], e21 = ema21[idx];
      let bias = 'NEUTRAL';
      if (price > vwapNow && e9 > e21) bias = 'BULLISH';
      else if (price < vwapNow && e9 < e21) bias = 'BEARISH';
      if (bias === 'NEUTRAL') continue;

      // Swing levels from last 20 candles
      const levels = detectSwingLevels(dH, dL, Math.max(0, idx - 20), idx);

      // Check for sweep in last 3 candles
      let sweep = null;
      for (let k = Math.max(idx - 3, 0); k <= idx; k++) {
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

      // Check for MSS after sweep
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

      // SPY/VIX convergence check
      const targetTs = data.timestamps[dc[idx]];
      let spyOk = false, vixOk = false;
      if (spyD) {
        const si = spyD.timestamps.findIndex((t, i) => i > 0 && spyD.timestamps[i] >= targetTs) - 1;
        if (si >= 3 && spyD.closes[si] != null && spyD.closes[si - 3] != null) {
          const chg = spyD.closes[si] - spyD.closes[si - 3];
          spyOk = bias === 'BULLISH' ? chg > 0 : chg < 0;
        }
      }
      if (vixD) {
        const vi = vixD.timestamps.findIndex((t, i) => i > 0 && vixD.timestamps[i] >= targetTs) - 1;
        if (vi >= 3 && vixD.closes[vi] != null && vixD.closes[vi - 3] != null) {
          const chg = vixD.closes[vi] - vixD.closes[vi - 3];
          vixOk = bias === 'BULLISH' ? chg < 0 : chg > 0;
        }
      }

      // Score
      let score = 2 + 2; // sweep + mss
      if ((bias === 'BULLISH' && price > vwapNow) || (bias === 'BEARISH' && price < vwapNow)) score += 2;
      if (spyOk) score += 1;
      if (vixOk) score += 1;
      // Skip RVOL and vwapSlope for simplicity in backtest

      if (score < 5) continue;

      // Killzone check
      const candleMin = getMinET(data.timestamps[dc[idx]]);
      if (candleMin > 660 && candleMin < 840) continue; // Skip midday

      // Entry
      const dir = bias === 'BULLISH' ? 'CALL' : 'PUT';
      const entry = +price.toFixed(2);
      const sweepExtreme = sweep.type === 'BULL' ? sweep.sweepLow : sweep.sweepHigh;
      const slDist = Math.min(1.50, Math.abs(price - sweepExtreme) + 0.10);
      const tp1Dist = slDist * 2;
      const tp2Dist = slDist * 3;
      const sl = dir === 'CALL' ? +(entry - slDist).toFixed(2) : +(entry + slDist).toFixed(2);
      const tp1 = dir === 'CALL' ? +(entry + tp1Dist).toFixed(2) : +(entry - tp1Dist).toFixed(2);
      const tp2 = dir === 'CALL' ? +(entry + tp2Dist).toFixed(2) : +(entry - tp2Dist).toFixed(2);

      // Walk forward to find exit
      let exitPrice = null, resultado = 'CIERRE';
      for (let f = idx + 1; f < dc.length; f++) {
        if (dir === 'CALL') {
          if (dL[f] <= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (dH[f] >= tp2) { exitPrice = tp2; resultado = 'TP2'; break; }
          if (dH[f] >= tp1 && !exitPrice) { /* partial — let it run to TP2 */ }
        } else {
          if (dH[f] >= sl) { exitPrice = sl; resultado = 'STOP'; break; }
          if (dL[f] <= tp2) { exitPrice = tp2; resultado = 'TP2'; break; }
        }
      }
      if (!exitPrice) { exitPrice = dC[dc.length - 1] || entry; resultado = 'CIERRE'; }

      const pnl = dir === 'CALL' ? +(exitPrice - entry).toFixed(2) : +(entry - exitPrice).toFixed(2);
      const hora = new Date(data.timestamps[dc[idx]] * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });

      trades.push({
        hora, ticker, dir, entry, sl, tp1, tp2, exit: +exitPrice.toFixed(2),
        pnl, pnlC: +(pnl * DOLLAR_PER_MOVE).toFixed(0), resultado, score,
        setup: sweep.type === 'BULL' ? 'Sweep+MSS' : 'Sweep+MSS',
        spyOk, vixOk,
      });
      inTrade = true; // 1 trade per ticker per day
    }
  }
  return trades;
}

// ═══ COMPONENT ═══
export default function Live4() {
  const [ticker, setTicker] = useState('QQQ');
  const [signal, setSignal] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [activeTrade, setActiveTrade] = useState(null);
  const [coachMsg, setCoachMsg] = useState(null);
  const [error, setError] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [marketTime, setMarketTime] = useState('');
  const [todayTrades, setTodayTrades] = useState([]);

  // Sim / Backtest
  const [simOpen, setSimOpen] = useState(false);
  const [btLoading, setBtLoading] = useState(false);
  const [btTrades, setBtTrades] = useState([]);
  const [btRange, setBtRange] = useState('week');
  const [btDate, setBtDate] = useState(new Date().toISOString().slice(0, 10));

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
    const { direction, entry, sl, tp1, tp2, beTriggered } = activeTrade;
    // BE logic: if price hits TP1, move SL to entry
    if (!beTriggered) {
      if ((direction === 'CALL' && livePrice >= tp1) || (direction === 'PUT' && livePrice <= tp1))
        return setActiveTrade(prev => ({ ...prev, sl: entry, beTriggered: true }));
    }
    const curSl = beTriggered ? entry : sl;
    if ((direction === 'CALL' && livePrice <= curSl) || (direction === 'PUT' && livePrice >= curSl)) { setActiveTrade(null); return; }
    if ((direction === 'CALL' && livePrice >= tp2) || (direction === 'PUT' && livePrice <= tp2)) { setActiveTrade(null); return; }
  }, [livePrice, activeTrade]);

  // Load saved trades
  async function loadTrades() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/db/trades?limit=50'); const data = await res.json();
      if (data.ok) setTodayTrades((data.data || []).filter(t => t.session === today || t.opened_at?.startsWith(today)));
    } catch {}
  }

  // Save trade to DB
  async function saveTrade(sig) {
    if (!sig?.trade) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await fetch('/api/db/trades', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: sig.ticker, signal: sig.signal, entry: sig.trade.entry,
          sl: sig.trade.sl, tp: sig.trade.tp2, score: sig.score,
          setupGrade: sig.grade, volumeZone: sig.setupType || '', session: today,
          notes: `ICT Smart Money: ${sig.reason}`,
        }),
      });
      await loadTrades();
    } catch {}
  }

  // Coach message generator
  function generateCoach(sig, lp, trade) {
    const now = ts();
    if (trade) {
      const p = lp || trade.entry;
      const pnl = trade.direction === 'CALL' ? p - trade.entry : trade.entry - p;
      const pnlC = +(pnl * DOLLAR_PER_MOVE).toFixed(0);
      if (trade.beTriggered) return { time: now, text: `BE activo. PnL ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} ($${pnlC >= 0 ? '+' : ''}${pnlC})`, type: 'go' };
      if (pnl > 0) return { time: now, text: `+$${pnl.toFixed(2)} (+$${pnlC}) — BE en TP1 $${trade.tp1}`, type: 'go' };
      return { time: now, text: `$${pnl.toFixed(2)} ($${pnlC}) — SL $${trade.sl}`, type: pnl < -0.30 ? 'danger' : 'info' };
    }
    if (!sig) return { time: now, text: 'Cargando...', type: 'info' };
    if (sig.session === 'CLOSED') return { time: now, text: 'Mercado cerrado', type: 'info' };
    if (sig.phase === 'GO' && sig.trade) return { time: now, text: `ENTRAR ${sig.signal} ${sig.ticker} @$${sig.trade.entry} — ${sig.setupType?.replace(/_/g, ' ')} — Score ${sig.score}/10`, type: 'go' };
    if (sig.phase === 'ZONE') return { time: now, text: `Zona ${sig.signal} — ${sig.setupType?.replace(/_/g, ' ')} — Score ${sig.score}/10 (${sig.grade})`, type: 'watch' };
    const parts = [];
    if (sig.smartMoney?.sweep) parts.push(sig.smartMoney.sweep.type.replace(/_/g, ' '));
    if (sig.smartMoney?.mss) parts.push(sig.smartMoney.mss.type.replace(/_/g, ' '));
    if (sig.smartMoney?.fvg) parts.push(sig.smartMoney.fvg.type.replace(/_/g, ' '));
    if (sig.smartMoney?.vwapReclaim?.detected) parts.push('VWAP Reclaim');
    if (sig.context?.regime) parts.push(sig.context.regime);
    return { time: now, text: parts.length ? parts.join(' · ') : (sig.reason || `Monitoreando ${ticker}`), type: parts.length >= 3 ? 'watch' : 'info' };
  }

  // Main data poll — 60s auto-refresh (5s during active trade)
  const loadData = useCallback(async () => {
    try {
      const [sig, scan] = await Promise.all([analyzeSmartMoney(ticker), smartMoneyScan(TICKERS)]);
      setSignal(sig); setScanResult(scan); setError(null);
      setCoachMsg(generateCoach(sig, livePrice, activeTrade));

      // Auto-enter on GO
      if (!activeTrade && sig?.phase === 'GO' && sig?.trade) {
        const t = sig.trade;
        setActiveTrade({ ...t, ticker: sig.ticker, direction: sig.signal, beTriggered: false, startTime: new Date().toISOString() });
        saveTrade(sig);
      }
      await loadTrades();
      setCountdown(activeTrade ? 5 : 60);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch { setError('Error cargando datos'); }
  }, [ticker, activeTrade, livePrice]);

  const [lastUpdate, setLastUpdate] = useState(null);

  // Auto-reload when countdown hits 0
  useEffect(() => {
    if (countdown === 0 && signal) { if (isMarketOpen()) loadData(); }
  }, [countdown]);

  // Initial load
  useEffect(() => { loadData(); }, [ticker, !!activeTrade]);

  // Backtest runner
  const runBacktest = async (mode) => {
    setBtLoading(true); setBtTrades([]);
    try {
      if (mode === 'week') {
        const probe = await fetchHist('QQQ', '5d');
        if (!probe) { setBtLoading(false); return; }
        const dates = [...new Set(probe.timestamps.map(t => getDateET(t)))].sort();
        const allTrades = [];
        for (const d of dates) {
          const dt = await backtestSmartMoney(d);
          allTrades.push(...dt.map(t => ({ ...t, fecha: d })));
        }
        setBtTrades(allTrades);
      } else {
        const dt = await backtestSmartMoney(btDate);
        setBtTrades(dt.map(t => ({ ...t, fecha: btDate })));
      }
    } catch (e) { console.error('Backtest error:', e); }
    setBtLoading(false);
  };

  // ── Derived state ──
  const ctx = signal?.context || {};
  const sm = signal?.smartMoney || {};
  const mom = signal?.momentum || {};
  const trade = signal?.trade;
  const price = livePrice || signal?.price || 0;
  const scoring = signal?.scoring || {};

  // v3 Multi-TF checklist
  const bias1h = signal?.bias1h || {};
  const conf15m = signal?.conf15m || {};
  const checks = [
    { label: '1H Bias', done: bias1h.bias && bias1h.bias !== 'NEUTRAL', value: bias1h.bias === 'BULLISH' ? 'Bull' : bias1h.bias === 'BEARISH' ? 'Bear' : '—', pts: scoring.bias1h || 0, max: 1 },
    { label: '15M Confirm', done: !!conf15m.confirmed, value: conf15m.confirmed ? 'Aligned' : '—', pts: scoring.conf15m || 0, max: 1 },
    { label: '5M Sweep', done: !!sm.sweep, value: sm.sweep ? sm.sweep.type.replace(/_/g, ' ').replace('BULLISH ', 'Bull ').replace('BEARISH ', 'Bear ') : '—', pts: scoring.sweep || 0, max: 2 },
    { label: '5M MSS/CHoCH', done: !!sm.mss, value: sm.mss ? sm.mss.type.replace(/_/g, ' ').replace('BULLISH ', 'Bull ').replace('BEARISH ', 'Bear ') : '—', pts: scoring.mss || 0, max: 2 },
    { label: 'VWAP 5M', done: scoring.vwap > 0, value: ctx.vwap ? `$${typeof ctx.vwap === 'number' ? ctx.vwap.toFixed(2) : ctx.vwap}` : '—', pts: scoring.vwap || 0, max: 1 },
    { label: 'FVG', done: !!sm.fvg, value: sm.fvg ? sm.fvg.type.replace(/_/g, ' ').replace('BULLISH ', 'Bull ').replace('BEARISH ', 'Bear ') : '—', pts: scoring.fvg || 0, max: 1 },
    { label: 'Displacement', done: !!sm.displacement, value: sm.displacement ? sm.displacement.dir : '—', pts: scoring.disp || 0, max: 1 },
    { label: 'VWAP Reclaim', done: !!sm.vwapReclaim?.detected, value: sm.vwapReclaim?.detected ? `$${sm.vwapReclaim.vwap}` : '—', pts: scoring.reclaim || 0, max: 1 },
    { label: 'SPY', done: ctx.spy?.ok, value: ctx.spy?.trend ? `${ctx.spy.trend > 0 ? '+' : ''}${ctx.spy.trend}` : '—', pts: scoring.spy || 0, max: 1 },
    { label: 'VIX', done: ctx.vix?.ok, value: ctx.vixLevel ? `${ctx.vixLevel}` : '—', pts: scoring.vix || 0, max: 1 },
    { label: 'RVOL', done: mom.rvol >= 1.5, value: mom.rvol ? `${mom.rvol}x` : '—', pts: scoring.rvol || 0, max: 1 },
    { label: 'Rejection Zone', done: !!sm.rejectionZone, value: sm.rejectionZone ? `${sm.rejectionZone.type} $${sm.rejectionZone.price} (${sm.rejectionZone.strength})` : '—', pts: scoring.rejection || 0, max: 2 },
  ];
  const done = checks.filter(c => c.done).length;
  const totalScore = signal?.score || 0;

  // Helper: bias color variant
  const biasVariant = (b) => {
    if (b === 'BULLISH') return 'border-emerald-500/20 bg-emerald-500/10';
    if (b === 'BEARISH') return 'border-red-500/20 bg-red-500/10';
    return 'border-amber-500/20 bg-amber-500/10';
  };
  const biasText = (b) => {
    if (b === 'BULLISH') return 'text-emerald-300';
    if (b === 'BEARISH') return 'text-red-300';
    return 'text-amber-300';
  };
  const signalVariant = (s) => {
    if (s === 'CALL') return 'border-emerald-500/20 bg-emerald-500/10';
    if (s === 'PUT') return 'border-red-500/20 bg-red-500/10';
    return 'border-border/60 bg-card';
  };
  const signalText = (s) => {
    if (s === 'CALL') return 'text-emerald-300';
    if (s === 'PUT') return 'text-red-300';
    return 'text-muted-foreground';
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">

        {/* ERROR */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300 text-center">
            {error}
            <button onClick={loadData} className="underline ml-2">Reintentar</button>
          </div>
        )}

        {/* ═══ 1. HEADER ═══ */}
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm space-y-4">
          {/* Ticker selector */}
          <div className="flex flex-wrap gap-1.5">
            {TICKERS.map(t => {
              const hasSig = scanResult?.signals?.find(s => s.ticker === t);
              const isAct = activeTrade?.ticker === t;
              return (
                <button key={t} onClick={() => !activeTrade && setTicker(t)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    isAct
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : hasSig
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : ticker === t
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary/50'
                  }`}>
                  {t}
                </button>
              );
            })}
          </div>

          {/* Price + bias + clock row */}
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Live Price</div>
              <div className="text-3xl font-semibold font-mono text-foreground">${price ? price.toFixed(2) : '—'}</div>
              <div className={`text-xs mt-1 font-medium ${biasText(ctx.bias)}`}>
                {ctx.bias === 'BULLISH' ? 'Bullish' : ctx.bias === 'BEARISH' ? 'Bearish' : 'Neutral'}
                {ctx.regime && <span className={`ml-2 ${biasText(ctx.bias)}`}>· {REGIME_ICONS[ctx.regime] || ctx.regime}</span>}
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{marketTime} ET</div>
              <div className={`text-xs font-mono font-semibold ${countdown <= 5 ? 'text-amber-300' : 'text-muted-foreground'}`}>
                {countdown}s
              </div>
              <div className="w-20 h-1 rounded-full bg-secondary/50 overflow-hidden">
                <div className="h-full rounded-full bg-primary/60 transition-all duration-1000" style={{ width: `${(countdown / (activeTrade ? 5 : 60)) * 100}%` }} />
              </div>
            </div>
          </div>

          {/* Killzone + Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {signal?.killzone || signal?.session ? (
              <span className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
                {KZ_LABELS[signal?.killzone] || KZ_LABELS[signal?.session] || '—'}
              </span>
            ) : null}
            {signal?.setupType && signal.setupType !== 'NONE' && (
              <span className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                signal.setupType.includes('SWEEP') ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
              }`}>
                {signal.setupType.replace(/_/g, ' ')}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <button onClick={loadData}
                className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-all">
                Analizar
              </button>
              {signal?.trade && (
                <button onClick={() => saveTrade(signal)}
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all">
                  Guardar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ═══ 2. SIGNAL CARD ═══ */}
        {activeTrade ? (() => {
          const pnl = activeTrade.direction === 'CALL' ? (livePrice || activeTrade.entry) - activeTrade.entry : activeTrade.entry - (livePrice || activeTrade.entry);
          const pnlC = +(pnl * DOLLAR_PER_MOVE).toFixed(0);
          const sl = activeTrade.beTriggered ? activeTrade.entry : activeTrade.sl;
          const range = Math.abs(activeTrade.tp2 - activeTrade.sl);
          const pct = Math.max(0, Math.min(100, activeTrade.direction === 'CALL' ? ((livePrice - activeTrade.sl) / range) * 100 : ((activeTrade.sl - livePrice) / range) * 100));
          return (
            <div className={`rounded-2xl border p-5 shadow-sm ${pnl >= 0 ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-red-500/20 bg-red-500/10'}`}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">
                {activeTrade.direction} {activeTrade.ticker} — Trade Activo
              </div>
              <div className={`text-4xl font-semibold font-mono mb-1 ${pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {pnlC >= 0 ? '+' : ''}${pnlC}
              </div>
              <div className="text-sm text-muted-foreground mb-4">
                Stock: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                {activeTrade.beTriggered ? ' · BE Activo' : ` · BE en TP1 $${activeTrade.tp1}`}
              </div>
              <div className="h-2 rounded-full bg-secondary/50 overflow-hidden mb-2">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: pnl >= 0 ? 'rgb(52 211 153)' : 'rgb(248 113 113)' }} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                <span className="text-red-300">SL ${sl}</span>
                <span>TP1 ${activeTrade.tp1}</span>
                <span className="text-emerald-300">TP2 ${activeTrade.tp2}</span>
              </div>
            </div>
          );
        })()

        : signal?.phase === 'GO' && trade ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Señal confirmada</div>
            <div className="text-2xl font-semibold text-emerald-300 mb-0.5">
              {signal.signal === 'CALL' ? 'CALL — Compra' : 'PUT — Vende'} {signal.ticker}
            </div>
            <div className="text-sm text-muted-foreground mb-1">
              Score {signal.score}/14 ({signal.grade}) · {signal.setupType?.replace(/_/g, ' ')}
            </div>
            <div className="text-lg font-semibold font-mono text-foreground">${trade.entry}</div>
          </div>
        )

        : (
          <div className={`rounded-2xl border p-5 shadow-sm ${done >= 7 ? 'border-emerald-500/20 bg-emerald-500/10' : done >= 5 ? 'border-amber-500/20 bg-amber-500/10' : 'border-border/60 bg-card'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className={`text-sm font-semibold ${done >= 7 ? 'text-emerald-300' : done >= 5 ? 'text-amber-300' : 'text-muted-foreground'}`}>
                {done >= 7 ? 'Entrar ahora' : done >= 5 ? 'Prepararse' : 'Esperando setup'}
              </div>
              <div className="text-xs text-muted-foreground font-mono">{ticker} ${price ? price.toFixed(2) : '—'}</div>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {signal?.signal && signal.signal !== 'NONE' ? signal.signal : ctx.bias === 'BEARISH' ? 'PUT' : 'CALL'}
              {signal?.setupType && signal.setupType !== 'NONE' && ` · ${signal.setupType.replace(/_/g, ' ')}`}
            </div>
          </div>
        )}

        {/* ═══ 3. TIMEFRAME GRID ═══ */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* 1H Bias */}
          <div className={`rounded-xl border p-3 ${biasVariant(bias1h.bias)}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">1H Bias</div>
            <div className={`text-sm font-semibold ${biasText(bias1h.bias)}`}>
              {bias1h.bias === 'BULLISH' ? 'Bullish' : bias1h.bias === 'BEARISH' ? 'Bearish' : 'Neutral'}
            </div>
            {bias1h.ema9 && (
              <div className="text-[10px] text-muted-foreground mt-1">EMA9 ${typeof bias1h.ema9 === 'number' ? bias1h.ema9.toFixed(2) : bias1h.ema9}</div>
            )}
          </div>

          {/* 15M Confirm */}
          <div className={`rounded-xl border p-3 ${conf15m.confirmed ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-border/60 bg-card'}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">15M Confirm</div>
            <div className={`text-sm font-semibold ${conf15m.confirmed ? 'text-emerald-300' : 'text-muted-foreground'}`}>
              {conf15m.confirmed ? 'Aligned' : 'No confirm'}
            </div>
            {conf15m.ema9 && (
              <div className="text-[10px] text-muted-foreground mt-1">EMA9 ${typeof conf15m.ema9 === 'number' ? conf15m.ema9.toFixed(2) : conf15m.ema9}</div>
            )}
          </div>

          {/* 5M Setup */}
          <div className={`rounded-xl border p-3 ${sm.sweep ? signalVariant(signal?.signal) : 'border-border/60 bg-card'}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">5M Setup</div>
            <div className={`text-sm font-semibold ${sm.sweep ? signalText(signal?.signal) : 'text-muted-foreground'}`}>
              {sm.sweep ? (sm.sweep.type.includes('BULL') ? 'Bull Sweep' : 'Bear Sweep') : 'No sweep'}
            </div>
            {sm.mss && (
              <div className="text-[10px] text-muted-foreground mt-1">MSS {sm.mss.type.includes('BULL') ? 'Bull' : 'Bear'}</div>
            )}
          </div>
        </div>

        {/* ═══ 4. CONFLUENCE GRID ═══ */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* SPY */}
          <div className={`rounded-xl border p-3 ${ctx.spy?.ok ? (ctx.bias === 'BULLISH' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-red-500/20 bg-red-500/10') : 'border-border/60 bg-card'}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">SPY</div>
            <div className={`text-sm font-semibold ${ctx.spy?.ok ? (ctx.bias === 'BULLISH' ? 'text-emerald-300' : 'text-red-300') : 'text-muted-foreground'}`}>
              {ctx.spy?.ok ? (ctx.spy.trend > 0 ? `+${ctx.spy.trend}` : ctx.spy.trend) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{ctx.spy?.ok ? 'Confluye' : 'Sin confluencia'}</div>
          </div>

          {/* VIX */}
          <div className={`rounded-xl border p-3 ${ctx.vix?.ok ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-border/60 bg-card'}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">VIX</div>
            <div className={`text-sm font-semibold ${ctx.vix?.ok ? 'text-emerald-300' : 'text-muted-foreground'}`}>
              {ctx.vixLevel ? ctx.vixLevel : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{ctx.vix?.ok ? 'Favorable' : 'Neutral'}</div>
          </div>

          {/* RVOL */}
          <div className={`rounded-xl border p-3 ${mom.rvol >= 1.5 ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-border/60 bg-card'}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">RVOL</div>
            <div className={`text-sm font-semibold ${mom.rvol >= 1.5 ? 'text-emerald-300' : 'text-muted-foreground'}`}>
              {mom.rvol ? `${mom.rvol}x` : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">{mom.rvol >= 1.5 ? 'Alto volumen' : 'Vol normal'}</div>
          </div>
        </div>

        {/* ═══ 5. ENTRY LEVELS CARD ═══ */}
        {trade && signal?.price > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">
              Niveles de entrada
              {signal?.signal && signal.signal !== 'NONE' && (
                <span className={`ml-2 font-semibold ${signalText(signal.signal)}`}>{signal.signal}</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Stop Loss</div>
                <div className="text-sm font-semibold text-red-300 font-mono">${trade.sl}</div>
                {trade.riskDollars && <div className="text-[10px] text-muted-foreground mt-1">-${trade.riskDollars}</div>}
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Entrada</div>
                <div className="text-sm font-semibold text-foreground font-mono">${trade.entry}</div>
                {trade.rr && <div className="text-[10px] text-muted-foreground mt-1">R:R {trade.rr}</div>}
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Target TP2</div>
                <div className="text-sm font-semibold text-emerald-300 font-mono">${trade.tp2}</div>
                {trade.tp2Dollars && <div className="text-[10px] text-muted-foreground mt-1">+${trade.tp2Dollars}</div>}
              </div>
            </div>
            {trade.tp1 && (
              <div className="mt-2 text-center text-[10px] text-muted-foreground">TP1 ${trade.tp1} · VWAP {ctx.vwap ? `$${typeof ctx.vwap === 'number' ? ctx.vwap.toFixed(2) : ctx.vwap}` : '—'}</div>
            )}
            {livePrice && trade.entry && (
              <div className="mt-2 text-center">
                <span className={`text-xs font-mono font-semibold ${Math.abs(price - trade.entry) < 0.50 ? 'text-amber-300' : 'text-muted-foreground'}`}>
                  Dist ${(price - trade.entry).toFixed(2)}
                </span>
              </div>
            )}
            {signal?.reason && <div className="mt-2 text-center text-[10px] text-muted-foreground">{signal.reason}</div>}
          </div>
        )}

        {/* ═══ 6. SMART MONEY DETAILS ═══ */}
        {(sm.sweep || sm.mss || sm.fvg || sm.ob || sm.displacement) && (
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">Smart Money Detections</div>
            <div className="grid grid-cols-2 gap-2">
              {sm.sweep && (
                <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sweep</div>
                  <div className={`text-sm font-semibold mt-0.5 ${sm.sweep.type.includes('BULL') ? 'text-emerald-300' : 'text-red-300'}`}>
                    {sm.sweep.type.includes('BULL') ? 'Bull' : 'Bear'} ${sm.sweep.level}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{sm.sweep.levelType}</div>
                </div>
              )}
              {sm.mss && (
                <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">MSS / CHoCH</div>
                  <div className={`text-sm font-semibold mt-0.5 ${sm.mss.type.includes('BULL') ? 'text-emerald-300' : 'text-red-300'}`}>
                    {sm.mss.type.includes('BULL') ? 'Bull' : 'Bear'} ${sm.mss.breakLevel}
                  </div>
                </div>
              )}
              {sm.fvg && (
                <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">FVG</div>
                  <div className={`text-sm font-semibold mt-0.5 ${sm.fvg.type.includes('BULL') ? 'text-emerald-300' : 'text-red-300'}`}>
                    {sm.fvg.type.includes('BULL') ? 'Bull' : 'Bear'} ${sm.fvg.bottom}–${sm.fvg.top}
                  </div>
                </div>
              )}
              {sm.ob && (
                <div className="rounded-xl border border-border/50 bg-secondary/30 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Order Block</div>
                  <div className={`text-sm font-semibold mt-0.5 ${sm.ob.type.includes('BULL') ? 'text-emerald-300' : 'text-red-300'}`}>
                    {sm.ob.type.includes('BULL') ? 'Bull' : 'Bear'} ${sm.ob.low}–${sm.ob.high}
                  </div>
                </div>
              )}
            </div>
            {sm.vwapReclaim?.detected && (
              <div className="mt-2 text-xs text-emerald-300">
                VWAP Reclaim @ ${typeof sm.vwapReclaim.vwap === 'number' ? sm.vwapReclaim.vwap.toFixed(2) : sm.vwapReclaim.vwap}
              </div>
            )}
            {sm.rejectionZone && (
              <div className="mt-1 text-xs text-muted-foreground">
                {sm.rejectionZone.type} Zone ${sm.rejectionZone.price} ({sm.rejectionZone.strength}, {sm.rejectionZone.count}x rejected)
              </div>
            )}
            {trade?.slAdjusted && (
              <div className="mt-1 text-xs text-amber-300">SL ajustado por zona de rechazo</div>
            )}
            <div className="mt-2 text-[10px] text-muted-foreground">
              Liquidity levels: {sm.liquidityLevels || 0} · Rejection zones: {sm.rejectionZones?.length || 0}
            </div>
          </div>
        )}

        {/* ═══ 7. SCORE BAR ═══ */}
        {totalScore != null && (
          <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-2">
              <span>
                Score {totalScore}/14
                {signal?.grade && (
                  <span className={`ml-1.5 font-semibold ${signal.grade === 'A+' ? 'text-emerald-300' : signal.grade === 'A' ? 'text-emerald-300' : signal.grade === 'B' ? 'text-amber-300' : 'text-red-300'}`}>
                    {signal.grade}
                  </span>
                )}
              </span>
              <span>{signal?.inKillzone ? 'Killzone activa' : 'Esperando KZ'}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${(totalScore / 14) * 100}%`,
                background: totalScore >= 9 ? 'rgb(52 211 153)' : totalScore >= 7 ? 'rgb(251 191 36)' : 'rgb(248 113 113)'
              }} />
            </div>
          </div>
        )}

        {/* ═══ 8. CHECKLIST ═══ */}
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">Checklist — {done}/12</div>
          <div className="space-y-1.5">
            {checks.map((c, i) => (
              <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 ${c.done ? 'border border-emerald-500/20 bg-emerald-500/10' : 'border border-border/40 bg-secondary/20'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${c.done ? 'bg-emerald-400' : 'bg-border'}`} />
                  <span className={`text-xs ${c.done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{c.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono ${c.done ? 'text-emerald-300' : 'text-muted-foreground/40'}`}>{c.value}</span>
                  <span className={`text-[10px] font-mono ${c.done ? 'text-emerald-300/60' : 'text-muted-foreground/30'}`}>+{c.pts}/{c.max}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-secondary/50 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${(done / 12) * 100}%`,
              background: done >= 7 ? 'rgb(52 211 153)' : done >= 5 ? 'rgb(251 191 36)' : 'rgb(100 116 139)'
            }} />
          </div>
        </div>

        {/* ═══ 9. COACH MESSAGE ═══ */}
        {coachMsg && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            coachMsg.type === 'go' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            : coachMsg.type === 'watch' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
            : coachMsg.type === 'danger' ? 'border-red-500/20 bg-red-500/10 text-red-300'
            : 'border-border/60 bg-card text-muted-foreground'
          }`}>
            <span className="text-[10px] opacity-50 mr-2 font-mono">{coachMsg.time}</span>
            <span className={`text-[10px] font-semibold mr-1.5 uppercase tracking-wide ${
              coachMsg.type === 'go' ? 'text-emerald-300'
              : coachMsg.type === 'watch' ? 'text-amber-300'
              : coachMsg.type === 'danger' ? 'text-red-300'
              : 'text-muted-foreground'
            }`}>
              {coachMsg.type === 'go' ? 'GO' : coachMsg.type === 'watch' ? 'WATCH' : coachMsg.type === 'danger' ? 'DANGER' : 'INFO'}
            </span>
            {coachMsg.text}
          </div>
        )}

        {/* ═══ 10. TICKER GRID ═══ */}
        <div className="grid grid-cols-4 gap-2">
          {TICKERS.map(t => {
            const item = scanResult?.signals?.find(s => s.ticker === t) || scanResult?.noSignal?.find(s => s.ticker === t);
            const hasSig = !!scanResult?.signals?.find(s => s.ticker === t);
            const itemBias = item?.bias1h?.bias;
            return (
              <button key={t} onClick={() => !activeTrade && setTicker(t)}
                className={`rounded-xl border p-2.5 text-left transition-all ${
                  hasSig ? 'border-emerald-500/20 bg-emerald-500/10'
                  : ticker === t ? 'border-primary/40 bg-primary/10'
                  : 'border-border/60 bg-card hover:bg-secondary/30'
                }`}>
                <div className={`text-[11px] font-semibold mb-0.5 ${hasSig ? 'text-emerald-300' : ticker === t ? 'text-primary' : 'text-foreground'}`}>{t}</div>
                <div className="text-sm font-semibold font-mono text-foreground">${item?.price ? (item.price > 100 ? item.price.toFixed(0) : item.price.toFixed(1)) : '—'}</div>
                <div className={`text-[10px] mt-0.5 ${itemBias === 'BULLISH' ? 'text-emerald-300' : itemBias === 'BEARISH' ? 'text-red-300' : 'text-muted-foreground'}`}>
                  {itemBias?.slice(0, 4) || '—'} {item?.score || 0}/14
                </div>
                {hasSig && <div className="text-[10px] font-semibold text-emerald-300 mt-0.5">ENTRAR</div>}
              </button>
            );
          })}
        </div>

        {/* ═══ 11. BACKTEST (collapsible) ═══ */}
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-sm">
          <button onClick={() => setSimOpen(!simOpen)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-secondary/20 transition-all">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Backtest Smart Money</span>
            <span className="text-muted-foreground text-xs">{simOpen ? '▲' : '▼'}</span>
          </button>

          {simOpen && (
            <div className="px-5 pb-5 space-y-4 border-t border-border/40">
              <div className="flex gap-2 pt-4">
                <input type="date" value={btDate} onChange={e => setBtDate(e.target.value)}
                  className="flex-1 rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground" />
                <button onClick={() => runBacktest('day')} disabled={btLoading}
                  className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary/50 disabled:opacity-50">
                  {btLoading ? '...' : '1 Dia'}
                </button>
                <button onClick={() => runBacktest('week')} disabled={btLoading}
                  className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
                  {btLoading ? '...' : '5 Dias'}
                </button>
              </div>

              {btLoading && (
                <div className="text-center py-6">
                  <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin mx-auto mb-2"></div>
                  <div className="text-xs text-muted-foreground">Analizando datos historicos...</div>
                </div>
              )}

              {btTrades.length > 0 && !btLoading && (
                <>
                  {/* Summary */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Trades', value: btTrades.length, color: 'text-foreground' },
                      { label: 'Win Rate', value: `${btTrades.length ? Math.round(btTrades.filter(t => t.pnl > 0).length / btTrades.length * 100) : 0}%`, color: 'text-foreground' },
                      {
                        label: 'PnL Stock',
                        value: `${btTrades.reduce((s, t) => s + t.pnl, 0) >= 0 ? '+' : ''}$${btTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2)}`,
                        color: btTrades.reduce((s, t) => s + t.pnl, 0) >= 0 ? 'text-emerald-300' : 'text-red-300',
                      },
                      {
                        label: 'PnL $50/mov',
                        value: `${btTrades.reduce((s, t) => s + t.pnlC, 0) >= 0 ? '+' : ''}$${btTrades.reduce((s, t) => s + t.pnlC, 0)}`,
                        color: btTrades.reduce((s, t) => s + t.pnlC, 0) >= 0 ? 'text-emerald-300' : 'text-red-300',
                      },
                    ].map((item, i) => (
                      <div key={i} className="rounded-xl border border-border/50 bg-secondary/30 p-3 text-center">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{item.label}</div>
                        <div className={`text-sm font-semibold font-mono ${item.color}`}>{item.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Trade table */}
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <table className="w-full text-xs">
                      <thead className="bg-secondary/40">
                        <tr className="text-muted-foreground">
                          <th className="text-left px-3 py-2">Fecha</th>
                          <th className="text-left px-2 py-2">Hora</th>
                          <th className="text-left px-2 py-2">Ticker</th>
                          <th className="text-center px-2 py-2">Dir</th>
                          <th className="text-right px-2 py-2">Entry</th>
                          <th className="text-right px-2 py-2">Exit</th>
                          <th className="text-right px-2 py-2">$Cont</th>
                          <th className="text-center px-2 py-2">Res</th>
                          <th className="text-right px-3 py-2">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {btTrades.map((t, i) => (
                          <tr key={i} className={`border-t border-border/30 ${t.pnl > 0 ? 'bg-emerald-500/5' : t.pnl < 0 ? 'bg-red-500/5' : ''}`}>
                            <td className="px-3 py-2 text-muted-foreground font-mono">{t.fecha?.slice(5)}</td>
                            <td className="px-2 py-2 text-muted-foreground font-mono">{t.hora}</td>
                            <td className="px-2 py-2 font-medium text-foreground">{t.ticker}</td>
                            <td className={`px-2 py-2 text-center font-medium ${t.dir === 'CALL' ? 'text-emerald-300' : 'text-red-300'}`}>{t.dir}</td>
                            <td className="px-2 py-2 text-right font-mono text-foreground">${t.entry}</td>
                            <td className="px-2 py-2 text-right font-mono text-foreground">${t.exit}</td>
                            <td className={`px-2 py-2 text-right font-mono font-semibold ${t.pnlC > 0 ? 'text-emerald-300' : t.pnlC < 0 ? 'text-red-300' : 'text-foreground'}`}>
                              {t.pnlC >= 0 ? '+' : ''}${t.pnlC}
                            </td>
                            <td className={`px-2 py-2 text-center font-medium ${t.resultado === 'TP2' ? 'text-emerald-300' : t.resultado === 'STOP' ? 'text-red-300' : 'text-muted-foreground'}`}>
                              {t.resultado}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">{t.score}/10</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Per-day breakdown if multi-day */}
                  {btTrades.some(t => t.fecha) && [...new Set(btTrades.map(t => t.fecha))].length > 1 && (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Por dia</div>
                      {[...new Set(btTrades.map(t => t.fecha))].sort().map(d => {
                        const dt = btTrades.filter(t => t.fecha === d);
                        const total = dt.reduce((s, t) => s + t.pnlC, 0);
                        const wins = dt.filter(t => t.pnl > 0).length;
                        return (
                          <div key={d} className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/20 px-3 py-2">
                            <span className="text-xs text-muted-foreground font-mono">{d}</span>
                            <span className="text-xs text-muted-foreground">{dt.length} trades · {wins}W {dt.length - wins}L</span>
                            <span className={`text-xs font-semibold font-mono ${total >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                              {total >= 0 ? '+' : ''}${total}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {btTrades.length === 0 && !btLoading && (
                <div className="text-center text-muted-foreground text-xs py-4">
                  Sin trades — clickea "5 Dias" para backtest
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ 12. TRADES HOY ═══ */}
        {todayTrades.length > 0 && (
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-3">
              Trades Hoy ({todayTrades.length})
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-xs">
                <thead className="bg-secondary/40">
                  <tr className="text-muted-foreground">
                    <th className="text-left px-3 py-2">Ticker</th>
                    <th className="text-center px-2 py-2">Dir</th>
                    <th className="text-right px-2 py-2">Entry</th>
                    <th className="text-right px-3 py-2">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {todayTrades.map((t, i) => {
                    const entry = parseFloat(t.entry), exit = t.exit_price ? parseFloat(t.exit_price) : null;
                    const pnl = exit ? (t.signal === 'CALL' ? exit - entry : entry - exit) : null;
                    const pnlC = pnl ? +(pnl * DOLLAR_PER_MOVE).toFixed(0) : null;
                    return (
                      <tr key={i} className={`border-t border-border/30 ${pnl && pnl > 0 ? 'bg-emerald-500/5' : pnl && pnl < 0 ? 'bg-red-500/5' : ''}`}>
                        <td className="px-3 py-2 font-medium text-foreground">{t.ticker}</td>
                        <td className={`px-2 py-2 text-center font-medium ${t.signal === 'CALL' ? 'text-emerald-300' : 'text-red-300'}`}>{t.signal}</td>
                        <td className="px-2 py-2 text-right font-mono text-foreground">${entry.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">
                          {pnlC != null ? (
                            <span className={`font-semibold font-mono ${pnlC >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                              {pnlC >= 0 ? '+' : ''}${pnlC}
                            </span>
                          ) : (
                            <span className="text-primary text-xs">Abierto</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
