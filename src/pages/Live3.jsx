import React, { useEffect, useState, useCallback, useRef } from 'react';
import { fetchYahooPrice } from '@/lib/realtimePriceBuffer';
import { analyzeScalp, scalpScan, resetCircuitBreaker, reportLoss, reportWin } from '@/lib/scalpEngine';

const TICKERS = ['QQQ', 'SPY'];
const DOLLAR_PER_MOVE = 40;

function ts() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function isMarketOpen() { const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes(); return d > 0 && d < 6 && m >= 570 && m < 960; }

export default function Live3() {
  const [ticker, setTicker] = useState('QQQ');
  const [signal, setSignal] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const [activeTrade, setActiveTrade] = useState(null);
  const [coachMsg, setCoachMsg] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);
  const [countdown, setCountdown] = useState(0);
  const [marketTime, setMarketTime] = useState('');

  // Market clock + countdown
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

  // Price 2s
  useEffect(() => {
    let on = true;
    const poll = async () => { try { const p = await fetchYahooPrice(activeTrade?.ticker || ticker); if (p && on) setLivePrice(p); } catch {} };
    poll();
    const id = setInterval(() => { if (isMarketOpen()) poll(); }, 2000);
    return () => { on = false; clearInterval(id); };
  }, [ticker, activeTrade?.ticker]);

  // Trade monitor
  useEffect(() => {
    if (!activeTrade || !livePrice) return;
    const { direction, entry, sl, tp1, tp2 } = activeTrade;
    if (direction === 'CALL' && livePrice <= sl) { reportLoss(); setActiveTrade(null); }
    if (direction === 'CALL' && livePrice >= tp2) { reportWin(); setActiveTrade(null); }
    if (direction === 'PUT' && livePrice >= sl) { reportLoss(); setActiveTrade(null); }
    if (direction === 'PUT' && livePrice <= tp2) { reportWin(); setActiveTrade(null); }
  }, [livePrice, activeTrade]);

  // Main poll 60s
  const loadData = useCallback(async () => {
    try {
      const [sig, scan] = await Promise.all([analyzeScalp(ticker), scalpScan(TICKERS)]);
      setSignal(sig); setScanResult(scan); setError(null);

      // Coach
      const now = ts();
      if (sig?.phase === 'CIRCUIT_BREAKER') setCoachMsg({ time: now, text: '2 losses seguidas — bot detenido', type: 'danger' });
      else if (sig?.phase === 'GO' && sig?.trade && !activeTrade) {
        setCoachMsg({ time: now, text: `ENTRAR ${sig.signal} ${sig.ticker} @$${sig.trade.entry} — Riesgo $${sig.trade.riskDollars} Ganancia $${sig.trade.tp2Dollars}`, type: 'go' });
        setActiveTrade({ ...sig.trade, ticker: sig.ticker, direction: sig.signal });
      } else if (sig?.phase === 'ZONE') setCoachMsg({ time: now, text: `Zona ${sig.signal} — Score ${sig.score} (${sig.grade}) — ${sig.reason}`, type: 'watch' });
      else {
        const parts = [];
        if (sig?.context?.bias && sig.context.bias !== 'NEUTRAL') parts.push(sig.context.bias);
        if (sig?.smartMoney?.sweep) parts.push(sig.smartMoney.sweep.type.replace(/_/g, ' '));
        if (sig?.smartMoney?.fvg) parts.push(sig.smartMoney.fvg.type.replace(/_/g, ' '));
        if (sig?.smartMoney?.vwapReclaim?.detected) parts.push('VWAP Reclaim');
        if (sig?.momentum?.rsi) parts.push(`RSI ${sig.momentum.rsi}`);
        if (sig?.momentum?.rvol) parts.push(`RVOL ${sig.momentum.rvol}x`);
        setCoachMsg({ time: now, text: parts.length ? parts.join(' · ') : (sig?.reason || `Monitoreando ${ticker}`), type: parts.length >= 3 ? 'watch' : 'info' });
      }
      const secs = activeTrade ? 5 : 60;
      setCountdown(secs);
      setLastUpdate(new Date().toLocaleTimeString());
    } catch { setError('Error cargando datos'); }
  }, [ticker, activeTrade]);

  // Auto-reload when countdown hits 0
  useEffect(() => {
    if (countdown === 0 && signal) { if (isMarketOpen()) loadData(); }
  }, [countdown]);

  // Initial load
  useEffect(() => { loadData(); }, [ticker, !!activeTrade]);

  // Derived
  const ctx = signal?.context || {};
  const sm = signal?.smartMoney || {};
  const mom = signal?.momentum || {};
  const trade = signal?.trade;
  const price = livePrice || ctx.price || 0;

  // Checklist for Smart Money
  const checks = [
    { label: 'Contexto (VWAP+EMA)', done: ctx.canTrade && ctx.bias !== 'NEUTRAL', value: ctx.bias || '—' },
    { label: 'Smart Money', done: !!(sm.sweep || sm.fvg || sm.vwapReclaim?.detected), value: sm.sweep ? 'Sweep' : sm.fvg ? 'FVG' : sm.vwapReclaim?.detected ? 'Reclaim' : '—' },
    { label: 'RSI Momentum', done: mom.rsi > 55 || mom.rsi < 45, value: mom.rsi ? `${mom.rsi}` : '—' },
    { label: 'MACD Expanding', done: !!mom.macdExpanding, value: mom.macdExpanding ? '✅' : '—' },
    { label: 'Volumen (RVOL)', done: mom.rvol >= 1.5, value: mom.rvol ? `${mom.rvol}x` : '—' },
  ];
  const done = checks.filter(c => c.done).length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-lg mx-auto px-3 py-4 space-y-4">

        {error && <div className="rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm text-red-300 text-center">{error}</div>}

        {/* HEADER */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded-lg">0DTE</span>
            {TICKERS.map(t => (
              <button key={t} onClick={() => !activeTrade && setTicker(t)}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${ticker === t ? 'bg-white text-black' : 'bg-white/5 text-white/40'}`}>{t}</button>
            ))}
          </div>
          <div className="text-right">
            <div className="text-3xl font-black font-mono">${price ? price.toFixed(2) : '—'}</div>
            <div className="text-[10px] text-white/30">
              {ctx.bias === 'BULLISH' ? '↑ Bull' : ctx.bias === 'BEARISH' ? '↓ Bear' : '→ Neutral'}
            </div>
            <div className="flex items-center gap-2 text-[9px] text-white/20">
              <span className="font-mono">{marketTime}</span>
              <span>ET</span>
              <span className={`font-mono font-bold ${countdown <= 5 ? 'text-yellow-400' : 'text-white/30'}`}>{countdown}s</span>
              <div className="w-8 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400 transition-all duration-1000" style={{ width: `${(countdown / (activeTrade ? 5 : 60)) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* HERO CARD */}
        {activeTrade ? (() => {
          const pnl = activeTrade.direction === 'CALL' ? (livePrice || activeTrade.entry) - activeTrade.entry : activeTrade.entry - (livePrice || activeTrade.entry);
          const pnlC = +(pnl * DOLLAR_PER_MOVE).toFixed(0);
          const range = Math.abs(activeTrade.tp2 - activeTrade.sl);
          const pct = Math.max(0, Math.min(100, activeTrade.direction === 'CALL' ? ((livePrice - activeTrade.sl) / range) * 100 : ((activeTrade.sl - livePrice) / range) * 100));
          return (
            <div className={`rounded-3xl p-6 ${pnl >= 0 ? 'bg-gradient-to-b from-green-500/20 to-green-500/5 border-2 border-green-500/40' : 'bg-gradient-to-b from-red-500/20 to-red-500/5 border-2 border-red-500/40'}`}>
              <div className="text-center">
                <div className="text-[11px] text-white/40 uppercase tracking-widest">{activeTrade.direction} {activeTrade.ticker}</div>
                <div className={`text-6xl font-black font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pnlC >= 0 ? '+' : ''}${pnlC}</div>
                <div className="text-sm text-white/50 mt-1">Stock: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
              </div>
              <div className="mt-5 h-3 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, #ef4444, #f59e0b, #22c55e)`, backgroundSize: '300%', backgroundPosition: `${100 - pct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-white/30 mt-1 font-mono">
                <span className="text-red-400">SL ${activeTrade.sl}</span>
                <span>TP1 ${activeTrade.tp1}</span>
                <span className="text-green-400">TP2 ${activeTrade.tp2}</span>
              </div>
            </div>
          );
        })()

        : signal?.phase === 'GO' && trade ? (
          <div className="rounded-3xl p-8 bg-gradient-to-b from-green-500/30 to-green-500/5 border-4 border-green-400 animate-pulse text-center">
            <div className="text-7xl mb-3">🟢</div>
            <div className="text-4xl font-black text-green-400">{signal.signal} {signal.ticker}</div>
            <div className="text-2xl font-black text-white mt-1">${trade.entry}</div>
            <div className="text-sm text-green-300 mt-2">Score {signal.score} ({signal.grade})</div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-red-500/20 p-3 text-center">
                <div className="text-[10px] text-red-300">Stop Loss</div>
                <div className="text-lg font-black text-red-400 font-mono">${trade.sl}</div>
                <div className="text-[10px] text-red-300/60">-${trade.riskDollars}</div>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 text-center">
                <div className="text-[10px] text-white/40">TP1 (1R)</div>
                <div className="text-lg font-black text-white font-mono">${trade.tp1}</div>
                <div className="text-[10px] text-white/30">+${trade.tp1Dollars}</div>
              </div>
              <div className="rounded-2xl bg-green-500/20 p-3 text-center">
                <div className="text-[10px] text-green-300">TP2 (2R)</div>
                <div className="text-lg font-black text-green-400 font-mono">${trade.tp2}</div>
                <div className="text-[10px] text-green-300/60">+${trade.tp2Dollars}</div>
              </div>
            </div>
          </div>
        )

        : signal?.phase === 'CIRCUIT_BREAKER' ? (
          <div className="rounded-3xl p-6 border-2 border-red-500 bg-red-500/10 text-center">
            <div className="text-5xl mb-2">🛑</div>
            <div className="text-2xl font-black text-red-400">DETENIDO</div>
            <div className="text-sm text-red-300 mt-1">2 losses consecutivas</div>
            <button onClick={() => { resetCircuitBreaker(); loadData(); }} className="mt-3 px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20">Resetear</button>
          </div>
        )

        : (
          <div className={`rounded-3xl p-6 border-2 ${done >= 5 ? 'border-green-400 bg-green-500/10 animate-pulse' : done >= 3 ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
            <div className="text-center mb-4">
              <div className="text-5xl">{done >= 5 ? '🟢' : done >= 3 ? '🟡' : '🔴'}</div>
              <div className={`text-xl font-black mt-1 ${done >= 5 ? 'text-green-400' : done >= 3 ? 'text-yellow-300' : 'text-white/30'}`}>
                {done >= 5 ? 'ENTRAR' : done >= 3 ? 'PREPARARSE' : 'ESPERANDO SETUP'}
              </div>
              <div className="text-sm text-white font-mono">{ticker} ${price ? price.toFixed(2) : '—'}</div>
            </div>

            {/* Entry preview — siempre visible */}
            {trade && ctx.price > 0 && (
              <div className="mb-4 rounded-2xl overflow-hidden border border-white/10">
                <div className={`px-4 py-2 text-center text-[10px] uppercase tracking-widest font-bold ${done >= 4 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-white/5 text-white/30'}`}>
                  {done >= 4 ? 'Posible entrada' : 'Si se confirma'} — {signal?.potentialDir || ctx.bias === 'BEARISH' ? 'PUT' : 'CALL'}
                </div>
                <div className="p-4 bg-black/30">
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-red-500/15 p-3">
                      <div className="text-[9px] text-red-300 mb-1">Stop Loss</div>
                      <div className="text-lg font-black text-red-400 font-mono">${trade.sl}</div>
                      <div className="text-[10px] text-red-300/60">-${trade.riskDollars}</div>
                    </div>
                    <div className="rounded-xl bg-white/10 p-3">
                      <div className="text-[9px] text-white/40 mb-1">Entrada</div>
                      <div className="text-lg font-black text-white font-mono">${trade.entry}</div>
                    </div>
                    <div className="rounded-xl bg-green-500/15 p-3">
                      <div className="text-[9px] text-green-300 mb-1">Target 2R</div>
                      <div className="text-lg font-black text-green-400 font-mono">${trade.tp2}</div>
                      <div className="text-[10px] text-green-300/60">+${trade.tp2Dollars}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-center gap-4 text-[10px] text-white/30">
                    {ctx.vwap && <span>VWAP ${ctx.vwap}</span>}
                    {ctx.atr && <span>ATR ${ctx.atr}</span>}
                    <span>R:R 1:{trade.rr?.split(':')[1] || '2'}</span>
                  </div>
                  <div className="mt-1 text-center text-[10px] text-white/20">{signal?.reason}</div>
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

        {/* SCORE */}
        {signal?.score != null && (
          <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3">
            <div className="flex justify-between text-[10px] text-white/40 mb-2">
              <span>Score {signal.score}/100 <span className={`font-bold ${signal.grade === 'A+' ? 'text-green-400' : signal.grade === 'B' ? 'text-yellow-400' : 'text-red-400'}`}>{signal.grade}</span></span>
              <span>{signal.inWindow ? '✅ Sesion activa' : '⏸️ Esperando'}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${signal.score}%`, background: signal.score >= 75 ? '#22c55e' : signal.score >= 60 ? '#f59e0b' : '#ef4444' }} />
            </div>
          </div>
        )}

        {/* COACH */}
        {coachMsg && (
          <div className={`rounded-xl px-4 py-3 border text-sm ${coachMsg.type === 'go' ? 'bg-green-500/15 border-green-500/30 text-green-300' : coachMsg.type === 'watch' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300' : coachMsg.type === 'danger' ? 'bg-red-500/15 border-red-500/30 text-red-300' : 'bg-white/5 border-white/10 text-white/60'}`}>
            <span className="text-[9px] opacity-40 mr-2 font-mono">{coachMsg.time}</span>
            {coachMsg.type === 'go' ? '🟢 ' : coachMsg.type === 'watch' ? '🟡 ' : coachMsg.type === 'danger' ? '🔴 ' : ''}{coachMsg.text}
          </div>
        )}

        {/* TICKERS */}
        <div className="grid grid-cols-2 gap-2">
          {TICKERS.map(t => {
            const item = scanResult?.signals?.find(s => s.ticker === t) || scanResult?.noSignal?.find(s => s.ticker === t);
            const hasSig = !!scanResult?.signals?.find(s => s.ticker === t);
            return (
              <button key={t} onClick={() => !activeTrade && setTicker(t)}
                className={`rounded-2xl p-3 text-center transition-all ${hasSig ? 'bg-green-500/20 border-2 border-green-400 animate-pulse' : ticker === t ? 'bg-white/10 border border-white/15' : 'bg-white/[0.03] border border-white/5'}`}>
                <div className={`text-xs font-black ${hasSig ? 'text-green-400' : 'text-white/70'}`}>{t}</div>
                <div className="text-base font-bold font-mono text-white">${item?.price || '—'}</div>
                <div className={`text-[10px] mt-1 ${item?.context?.bias === 'BULLISH' ? 'text-green-400' : item?.context?.bias === 'BEARISH' ? 'text-red-400' : 'text-white/20'}`}>
                  {item?.context?.bias || '—'} · {item?.score || 0}pts
                </div>
                {hasSig && <div className="text-[10px] font-bold text-green-400">ENTRAR</div>}
              </button>
            );
          })}
        </div>

      </div>
    </div>
  );
}
