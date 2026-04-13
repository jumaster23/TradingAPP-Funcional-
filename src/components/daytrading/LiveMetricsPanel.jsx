import React from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, BarChart2 } from 'lucide-react';

function MetricBox({ label, value, sub, color = 'text-foreground', bg = '' }) {
  return (
    <div className={`rounded-lg p-2.5 border border-border/40 bg-secondary/30 text-center ${bg}`}>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value ?? '--'}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ProbBar({ probability }) {
  const raw = typeof probability === 'number' && isFinite(probability) ? probability : 50;
  const pct = Math.max(0, Math.min(100, raw));
  const isCall = pct >= 50;
  const failPct = 100 - pct;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span className="text-emerald-400">CALL {pct}%</span>
        <span className="text-red-400">PUT {failPct}%</span>
      </div>
      <div className="flex h-4 rounded-full overflow-hidden bg-secondary">
        <div
          className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 flex items-center justify-center text-[8px] font-bold text-white transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
        <div
          className="h-full bg-gradient-to-r from-red-500 to-red-400 flex items-center justify-center text-[8px] font-bold text-white transition-all duration-500"
          style={{ width: `${failPct}%` }}
        />
      </div>
    </div>
  );
}

export default function LiveMetricsPanel({ metrics, status, ticker }) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-24 text-[11px] text-muted-foreground">
        {status === 'loading' ? 'Cargando datos...' : 'Sin datos aún'}
      </div>
    );
  }

  const { ema9, ema20, ema50, atr, rsi, trend, volatility, probability, price, volRatio } = metrics;

  const trendConfig = {
    BULLISH: { icon: TrendingUp, color: 'text-emerald-400', label: 'ALCISTA' },
    BEARISH: { icon: TrendingDown, color: 'text-red-400', label: 'BAJISTA' },
    NEUTRAL: { icon: Minus, color: 'text-amber-400', label: 'NEUTRAL' },
  }[trend] || { icon: Minus, color: 'text-amber-400', label: 'NEUTRAL' };

  const TrendIcon = trendConfig.icon;

  const volColor = volatility === 'HIGH' ? 'text-red-400' : volatility === 'LOW' ? 'text-blue-400' : 'text-amber-400';

  return (
    <div className="space-y-3 p-3 bg-secondary/10 border-t border-border/20">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Activity className="w-3 h-3 text-primary" />
          Métricas en Tiempo Real — {ticker}
        </span>
        <span className={`flex items-center gap-1 text-[10px] font-bold ${trendConfig.color}`}>
          <TrendIcon className="w-3.5 h-3.5" />
          {trendConfig.label}
        </span>
      </div>

      {/* Probability bar */}
      <ProbBar probability={probability} />

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2">
        <MetricBox label="Precio" value={price ? `$${price.toFixed(2)}` : '--'} />
        <MetricBox
          label="RSI (14)"
          value={rsi ? rsi.toFixed(1) : '--'}
          color={rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-emerald-400' : 'text-amber-400'}
          sub={rsi > 70 ? 'Sobrecompra' : rsi < 30 ? 'Sobreventa' : 'Normal'}
        />
        <MetricBox
          label="Volatilidad"
          value={volatility}
          color={volColor}
          sub={metrics.volPct ? `${metrics.volPct.toFixed(2)}%/vela` : ''}
        />
      </div>

      <div className="grid grid-cols-4 gap-2">
        <MetricBox label="EMA 9" value={ema9 ? `$${ema9.toFixed(2)}` : '--'} color="text-cyan-400" />
        <MetricBox label="EMA 20" value={ema20 ? `$${ema20.toFixed(2)}` : '--'} color="text-purple-400" />
        <MetricBox label="EMA 50" value={ema50 ? `$${ema50.toFixed(2)}` : '--'} color="text-amber-400" />
        <MetricBox
          label="ATR (14)"
          value={atr ? `$${atr.toFixed(2)}` : '--'}
          sub={atr && price ? `${((atr / price) * 100).toFixed(1)}%` : ''}
        />
      </div>

      {/* Volume ratio */}
      <div className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-1.5 border border-border/30">
        <BarChart2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">Volumen vs promedio:</span>
        <span className={`text-[10px] font-bold ml-auto ${volRatio > 1.2 ? 'text-emerald-400' : volRatio < 0.5 ? 'text-red-400' : 'text-muted-foreground'}`}>
          {volRatio ? `${volRatio.toFixed(1)}x` : '--'}
          {volRatio > 1.2 ? ' ↑ Confirma' : volRatio < 0.5 ? ' ↓ Débil' : ' Normal'}
        </span>
      </div>
    </div>
  );
}