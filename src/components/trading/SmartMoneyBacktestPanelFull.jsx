import React, { useState, useEffect } from "react";

const STRATEGY_TYPES = ["sweep", "choch", "ob", "fvg"];

export default function SmartMoneyBacktestPanelFull({ trades }) {
  const [selectedType, setSelectedType] = useState("all");
  const [minRR, setMinRR] = useState(1.5);
  const [minVol, setMinVol] = useState(0);
  const [minATR, setMinATR] = useState(0);
  const [trend, setTrend] = useState("");
  const [confluencia, setConfluencia] = useState("");
  const [volatilidad, setVolatilidad] = useState("");

  // Sincronizar filtros con la mejor configuración guardada
  useEffect(() => {
    const saved = localStorage.getItem("sm_best_config");
    if (saved) {
      try {
        const config = JSON.parse(saved);
        if (config.params) {
          setMinRR(config.params.rr);
          setMinVol(config.params.vol);
          setMinATR(config.params.atr);
        }
      } catch {}
    }
  }, []);

  // Filtro avanzado
  const filtered = trades.filter(t => {
    if (selectedType !== "all" && !(t.setup?.toLowerCase().includes(selectedType))) return false;
    if (minRR && parseFloat(t.rr) < minRR) return false;
    if (minVol && parseFloat(t.volumen || 0) < minVol) return false;
    if (minATR && parseFloat(t.atr || 0) < minATR) return false;
    if (trend && !(t.tendencia?.toLowerCase().includes(trend.toLowerCase()))) return false;
    if (confluencia && !(t.nota?.toLowerCase().includes(confluencia.toLowerCase()))) return false;
    if (volatilidad && !(t.volatilidad?.toLowerCase().includes(volatilidad.toLowerCase()))) return false;
    return true;
  });

  const stats = {
    total: filtered.length,
    wins: filtered.filter(t => t.resultado?.toLowerCase() === 'win').length,
    losses: filtered.filter(t => t.resultado?.toLowerCase() === 'loss').length,
    rrProm: filtered.length ? filtered.reduce((a, t) => a + (parseFloat(t.rr) || 0), 0) / filtered.length : 0,
    winrate: filtered.length ? (filtered.filter(t => t.resultado?.toLowerCase() === 'win').length / filtered.length * 100).toFixed(1) : 0
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap gap-2 items-end">
        <select value={selectedType} onChange={e => setSelectedType(e.target.value)} className="bg-secondary border rounded px-2 py-1 text-sm">
          <option value="all">Todas las estrategias</option>
          {STRATEGY_TYPES.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
        </select>
        <label className="text-xs">RR mínimo
          <input type="number" step="0.1" value={minRR} onChange={e => setMinRR(Number(e.target.value))} className="ml-1 w-16 bg-secondary border rounded px-1 py-0.5 text-xs" />
        </label>
        <label className="text-xs">Volumen mínimo
          <input type="number" step="1" value={minVol} onChange={e => setMinVol(Number(e.target.value))} className="ml-1 w-16 bg-secondary border rounded px-1 py-0.5 text-xs" />
        </label>
        <label className="text-xs">ATR mínimo
          <input type="number" step="0.01" value={minATR} onChange={e => setMinATR(Number(e.target.value))} className="ml-1 w-16 bg-secondary border rounded px-1 py-0.5 text-xs" />
        </label>
        <input placeholder="Tendencia" value={trend} onChange={e => setTrend(e.target.value)} className="bg-secondary border rounded px-2 py-1 text-xs" />
        <input placeholder="Confluencia" value={confluencia} onChange={e => setConfluencia(e.target.value)} className="bg-secondary border rounded px-2 py-1 text-xs" />
        <input placeholder="Volatilidad" value={volatilidad} onChange={e => setVolatilidad(e.target.value)} className="bg-secondary border rounded px-2 py-1 text-xs" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-secondary/40 rounded-lg p-3 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Total Trades</p>
          <p className="text-xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-secondary/40 rounded-lg p-3 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Win Rate</p>
          <p className={"text-xl font-bold " + (stats.winrate >= 50 ? "text-emerald-400" : "text-red-400")}>{stats.winrate}%</p>
        </div>
        <div className="bg-secondary/40 rounded-lg p-3 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Avg RR</p>
          <p className="text-xl font-bold">{stats.rrProm.toFixed(2)}</p>
        </div>
        <div className="bg-secondary/40 rounded-lg p-3 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">Wins / Losses</p>
          <p className="text-xl font-bold"><span className="text-emerald-400">{stats.wins}</span> / <span className="text-red-400">{stats.losses}</span></p>
        </div>
      </div>
      <div className="bg-secondary/30 rounded-lg border border-border/40 overflow-hidden">
        <div className="p-3 border-b border-border/40">
          <p className="text-[10px] text-muted-foreground uppercase">Detalle de Trades Smart Money</p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead className="bg-secondary/50 sticky top-0">
              <tr className="text-muted-foreground">
                <th className="text-left p-2">Fecha</th>
                <th className="text-center p-2">Setup</th>
                <th className="text-center p-2">Resultado</th>
                <th className="text-right p-2">RR</th>
                <th className="text-right p-2">Volumen</th>
                <th className="text-right p-2">ATR</th>
                <th className="text-right p-2">Tendencia</th>
                <th className="text-right p-2">Confluencia</th>
                <th className="text-right p-2">Volatilidad</th>
                <th className="text-right p-2">Notas</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((trade, i) => (
                <tr key={i} className={
                  "border-b border-border/20 " +
                  (trade.resultado?.toLowerCase() === 'win' ? "bg-emerald-500/10" : trade.resultado?.toLowerCase() === 'loss' ? "bg-red-500/10" : "")
                }>
                  <td className="p-2 text-muted-foreground">{trade.fecha}</td>
                  <td className="p-2 text-center font-bold">{trade.setup}</td>
                  <td className={"p-2 text-center font-bold " + (trade.resultado?.toLowerCase() === 'win' ? 'text-emerald-400' : trade.resultado?.toLowerCase() === 'loss' ? 'text-red-400' : 'text-amber-400')}>{trade.resultado}</td>
                  <td className="p-2 text-right font-mono">{trade.rr}</td>
                  <td className="p-2 text-right font-mono">{trade.volumen}</td>
                  <td className="p-2 text-right font-mono">{trade.atr}</td>
                  <td className="p-2 text-right">{trade.tendencia}</td>
                  <td className="p-2 text-right">{trade.nota}</td>
                  <td className="p-2 text-right">{trade.volatilidad}</td>
                  <td className="p-2 text-right">{trade.nota}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <p className="text-center py-2 text-muted-foreground text-[9px]">
              ... y {filtered.length - 100} trades más
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
