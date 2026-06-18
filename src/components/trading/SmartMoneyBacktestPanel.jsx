import React from "react";

export default function SmartMoneyBacktestPanel({ trades, stats }) {
  if (!trades || trades.length === 0) return <div className="text-sm text-muted-foreground">No hay resultados de backtesting Smart Money.</div>;

  return (
    <div className="space-y-4 mt-4">
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
                <th className="text-right p-2">Notas</th>
              </tr>
            </thead>
            <tbody>
              {trades.slice(0, 100).map((trade, i) => (
                <tr key={i} className={
                  "border-b border-border/20 " +
                  (trade.resultado?.toLowerCase() === 'win' ? "bg-emerald-500/10" : trade.resultado?.toLowerCase() === 'loss' ? "bg-red-500/10" : "")
                }>
                  <td className="p-2 text-muted-foreground">{trade.fecha}</td>
                  <td className="p-2 text-center font-bold">{trade.setup}</td>
                  <td className={"p-2 text-center font-bold " + (trade.resultado?.toLowerCase() === 'win' ? 'text-emerald-400' : trade.resultado?.toLowerCase() === 'loss' ? 'text-red-400' : 'text-amber-400')}>{trade.resultado}</td>
                  <td className="p-2 text-right font-mono">{trade.rr}</td>
                  <td className="p-2 text-right">{trade.nota}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {trades.length > 100 && (
            <p className="text-center py-2 text-muted-foreground text-[9px]">
              ... y {trades.length - 100} trades más
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
