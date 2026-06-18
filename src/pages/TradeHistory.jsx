import React, { useEffect, useState } from 'react';

export default function TradeHistory() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [allDates, setAllDates] = useState([]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/db/trades?limit=200')
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setTrades(data.data || []);
          const dates = [...new Set((data.data || []).map(t => (t.session || t.opened_at?.slice(0, 10) || t.created_at?.slice(0, 10))))].filter(Boolean).sort().reverse();
          setAllDates(dates);
          if (dates.length && !dates.includes(selectedDate)) setSelectedDate(dates[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = trades.filter(t => {
    const d = t.session || t.opened_at?.slice(0, 10) || t.created_at?.slice(0, 10);
    return d === selectedDate;
  });

  const wins = filtered.filter(t => t.exit_price && ((t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) > 0));
  const losses = filtered.filter(t => t.exit_price && ((t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) < 0));
  const be = filtered.filter(t => t.exit_price && ((t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) === 0));
  const open = filtered.filter(t => !t.exit_price);
  const totalPnl = filtered.filter(t => t.exit_price).reduce((s, t) => {
    const pnl = t.signal === 'CALL' ? parseFloat(t.exit_price) - parseFloat(t.entry) : parseFloat(t.entry) - parseFloat(t.exit_price);
    return s + pnl;
  }, 0);

  // All-time stats
  const allClosed = trades.filter(t => t.exit_price);
  const allWins = allClosed.filter(t => (t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) > 0);
  const allLosses = allClosed.filter(t => (t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) < 0);
  const allPnl = allClosed.reduce((s, t) => s + (t.signal === 'CALL' ? parseFloat(t.exit_price) - parseFloat(t.entry) : parseFloat(t.entry) - parseFloat(t.exit_price)), 0);

  return (
    <div className="max-w-4xl mx-auto px-3 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">📊 Historial de Trades</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30">Filtrar por día:</span>
          <select value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-white">
            {allDates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* All-time summary */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-[9px] text-white/30">TOTAL TRADES</div>
          <div className="text-xl font-bold text-white">{allClosed.length}</div>
        </div>
        <div className="rounded-lg bg-green-500/10 p-3 text-center">
          <div className="text-[9px] text-white/30">WIN RATE</div>
          <div className="text-xl font-bold text-green-400">{allClosed.length ? (allWins.length / allClosed.length * 100).toFixed(0) : 0}%</div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-[9px] text-white/30">PnL TOTAL</div>
          <div className={`text-xl font-bold font-mono ${allPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>${allPnl.toFixed(2)}</div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 text-center">
          <div className="text-[9px] text-white/30">DÍAS</div>
          <div className="text-xl font-bold text-white">{allDates.length}</div>
        </div>
      </div>

      {/* Day summary */}
      <div className={`rounded-xl border p-4 ${totalPnl > 0 ? 'border-green-500/30 bg-green-500/5' : totalPnl < 0 ? 'border-red-500/30 bg-red-500/5' : 'border-white/10 bg-white/5'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-white/40 uppercase">Resumen del {selectedDate}</p>
            <p className={`text-2xl font-black font-mono ${totalPnl > 0 ? 'text-green-400' : totalPnl < 0 ? 'text-red-400' : 'text-white/50'}`}>
              ${totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="flex gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-green-400">{wins.length}</div>
              <div className="text-[8px] text-white/30">WINS</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-400">{losses.length}</div>
              <div className="text-[8px] text-white/30">LOSSES</div>
            </div>
            <div>
              <div className="text-lg font-bold text-white/40">{be.length}</div>
              <div className="text-[8px] text-white/30">BE</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-400">{open.length}</div>
              <div className="text-[8px] text-white/30">OPEN</div>
            </div>
          </div>
        </div>
      </div>

      {/* Trades list */}
      {loading ? (
        <div className="text-center py-8 text-white/30">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-white/30">Sin trades para esta fecha</div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((t, i) => {
            const pnl = t.exit_price ? (t.signal === 'CALL' ? parseFloat(t.exit_price) - parseFloat(t.entry) : parseFloat(t.entry) - parseFloat(t.exit_price)) : null;
            const isOpen = !t.exit_price;
            const time = t.opened_at ? new Date(t.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            return (
              <div key={i} className={`rounded-lg p-3 ${
                isOpen ? 'bg-blue-500/10 border border-blue-500/20' :
                pnl > 0 ? 'bg-green-500/10 border border-green-500/20' :
                pnl === 0 ? 'bg-white/5 border border-white/10' :
                'bg-red-500/10 border border-red-500/20'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {isOpen ? '🔵' : pnl > 0 ? '✅' : pnl === 0 ? '⚪' : '❌'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{t.ticker}</span>
                        <span className={`text-sm font-bold ${t.signal === 'CALL' ? 'text-green-400' : 'text-red-400'}`}>{t.signal}</span>
                        {t.volume_zone && <span className="text-[9px] text-white/30">@{t.volume_zone}</span>}
                        {t.setup_grade && <span className="text-[9px] px-1 rounded bg-white/10 text-white/40">{t.setup_grade}</span>}
                      </div>
                      <div className="text-[10px] text-white/30 font-mono mt-0.5">
                        Entry: ${parseFloat(t.entry).toFixed(2)} | SL: ${parseFloat(t.sl).toFixed(2)} | TP: ${parseFloat(t.tp).toFixed(2)}
                        {t.exit_price && ` → Exit: $${parseFloat(t.exit_price).toFixed(2)}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {isOpen ? (
                      <span className="text-blue-400 font-bold text-sm">ABIERTO</span>
                    ) : (
                      <>
                        <div className={`text-lg font-black font-mono ${pnl > 0 ? 'text-green-400' : pnl === 0 ? 'text-white/40' : 'text-red-400'}`}>
                          ${pnl.toFixed(2)}
                        </div>
                        <div className="text-[9px] text-white/30">{t.result}</div>
                      </>
                    )}
                    <div className="text-[8px] text-white/20 mt-0.5">{time}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Daily P&L chart (simple text) */}
      {allDates.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] text-white/40 uppercase font-bold mb-2">P&L POR DÍA</p>
          <div className="space-y-1">
            {allDates.slice(0, 30).map(date => {
              const dt = trades.filter(t => (t.session || t.opened_at?.slice(0,10)) === date && t.exit_price);
              const dpnl = dt.reduce((s, t) => s + (t.signal === 'CALL' ? parseFloat(t.exit_price) - parseFloat(t.entry) : parseFloat(t.entry) - parseFloat(t.exit_price)), 0);
              const dw = dt.filter(t => (t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) > 0).length;
              const dl = dt.filter(t => (t.signal === 'CALL' ? t.exit_price - t.entry : t.entry - t.exit_price) < 0).length;
              return (
                <button key={date} onClick={() => setSelectedDate(date)}
                  className={`w-full flex items-center justify-between text-[10px] rounded px-2 py-1 ${date === selectedDate ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                  <span className="text-white/50">{date}</span>
                  <span className="text-white/30">{dt.length} trades (W:{dw} L:{dl})</span>
                  <span className={`font-mono font-bold ${dpnl > 0 ? 'text-green-400' : dpnl < 0 ? 'text-red-400' : 'text-white/30'}`}>
                    ${dpnl.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
