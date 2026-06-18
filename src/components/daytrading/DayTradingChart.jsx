import React, { useState, useMemo, useEffect } from 'react';
// Note: useRef/useEffect still used by the main DayTradingChart component
import { Eye, EyeOff, ChevronDown, ChevronUp, ExternalLink, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useAlpacaStream } from '@/hooks/useAlpacaStream';
import LiveMetricsPanel from './LiveMetricsPanel';

// ── Strategy groups ───────────────────────────────────────────────────────────
function getGroups(data) {
  return [
    {
      key: 'scalp', label: '🔥 Scalp', color: '#f59e0b',
      entry: data?.scalp?.entry, sl: data?.scalp?.sl, tp: data?.scalp?.tp, signal: data?.scalp?.signal,
    },
    {
      key: 'intraday', label: '📈 Intraday', color: '#6366f1',
      entry: data?.intraday?.entry, sl: data?.intraday?.sl, tp: data?.intraday?.tp, signal: data?.intraday?.signal,
    },
    {
      key: 'liquidity', label: '💧 Liq. Sweep', color: '#ec4899',
      entry: data?.strategies?.liquidity_sweep?.entry, sl: data?.strategies?.liquidity_sweep?.sl,
      tp: data?.strategies?.liquidity_sweep?.tp, signal: data?.strategies?.liquidity_sweep?.signal,
      detected: data?.strategies?.liquidity_sweep?.detected,
      tradeReady: data?.strategies?.liquidity_sweep?.trade_ready,
      projected: data?.strategies?.liquidity_sweep?.projected_levels,
    },
    {
      key: 'pullback', label: '🔄 Pullback', color: '#14b8a6',
      entry: data?.strategies?.pullback_trend?.entry, sl: data?.strategies?.pullback_trend?.sl,
      tp: data?.strategies?.pullback_trend?.tp, signal: data?.strategies?.pullback_trend?.signal,
      detected: data?.strategies?.pullback_trend?.detected,
      tradeReady: data?.strategies?.pullback_trend?.trade_ready,
      projected: data?.strategies?.pullback_trend?.projected_levels,
    },
    {
      key: 'breakout', label: '🚀 Breakout', color: '#8b5cf6',
      entry: data?.strategies?.breakout_retest?.entry, sl: data?.strategies?.breakout_retest?.sl,
      tp: data?.strategies?.breakout_retest?.tp, signal: data?.strategies?.breakout_retest?.signal,
      detected: data?.strategies?.breakout_retest?.detected,
      tradeReady: data?.strategies?.breakout_retest?.trade_ready,
      projected: data?.strategies?.breakout_retest?.projected_levels,
    },
  ];
}

function groupHasData(g) { return !!(g.entry && (g.sl || g.tp)); }

// ── Level tag ─────────────────────────────────────────────────────────────────
function LevelTag({ label, value, typeColor }) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (!num || typeof num !== 'number' || !isFinite(num)) return null;
  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold whitespace-nowrap"
      style={{ backgroundColor: typeColor + '18', borderColor: typeColor + '60', color: typeColor }}
    >
      <span className="font-sans font-normal text-[9px] opacity-70">{label}</span>
      ${num.toFixed(2)}
    </div>
  );
}

function GroupLevels({ group }) {
  const isProjected = !!group.projected;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] font-semibold mr-1" style={{ color: group.color }}>{group.label}</span>
      {isProjected && (
        <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10">
          PROY
        </span>
      )}
      <LevelTag label="Entrada" value={group.entry} typeColor={group.color} />
      <LevelTag label="SL" value={group.sl} typeColor="#ef4444" />
      <LevelTag label="TP" value={group.tp} typeColor="#10b981" />
    </div>
  );
}

// ── Price ruler ───────────────────────────────────────────────────────────────
function PriceRuler({ activeGroups, livePrice }) {
  const toNum = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; };
  const allLevels = [];
  activeGroups.forEach(g => {
    const e = toNum(g.entry), s = toNum(g.sl), t = toNum(g.tp);
    const projected = !!g.projected;
    if (e) allLevels.push({ value: e, type: 'entry', color: g.color, projected });
    if (s) allLevels.push({ value: s, type: 'sl',    color: '#ef4444', projected });
    if (t) allLevels.push({ value: t, type: 'tp',    color: '#10b981', projected });
  });
  const lp = toNum(livePrice);
  if (lp) allLevels.push({ value: lp, type: 'live', color: '#38bdf8' });

  if (allLevels.length === 0) return null;

  const prices = allLevels.map(l => l.value);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const pad = range * 0.2;
  const lo = minP - pad;
  const hi = maxP + pad;
  const totalRange = hi - lo;
  const pct = (val) => ((1 - (val - lo) / totalRange) * 100).toFixed(2);
  const typeLabel = (t, projected) => {
    const base = t === 'entry' ? 'ENT' : t === 'sl' ? 'SL' : t === 'tp' ? 'TP' : '▶';
    return projected ? `${base}~` : base;
  };

  return (
    <div className="relative w-28 shrink-0 bg-secondary/20 border-l border-border/30 select-none overflow-hidden">
      <div className="absolute top-0 left-0 right-0 text-center py-1 text-[8px] text-muted-foreground border-b border-border/20 uppercase tracking-wide z-10 bg-secondary/40">
        Niveles
      </div>
      <div className="absolute inset-0 top-6 bottom-6">
        <div className="absolute top-0 right-1 text-[7px] text-muted-foreground/50 font-mono">${hi.toFixed(1)}</div>
        <div className="absolute bottom-0 right-1 text-[7px] text-muted-foreground/50 font-mono">${lo.toFixed(1)}</div>
        {allLevels.map((lv, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 flex items-center"
            style={{ top: `${pct(lv.value)}%`, transform: 'translateY(-50%)' }}
          >
            <div
              className="h-px flex-1"
              style={{
                opacity: lv.projected ? 0.4 : 0.6,
                background: lv.projected
                  ? `repeating-linear-gradient(90deg,transparent 0,transparent 2px,${lv.color} 2px,${lv.color} 4px,transparent 4px,transparent 8px)`
                  : `repeating-linear-gradient(90deg,${lv.color} 0,${lv.color} 3px,transparent 3px,transparent 7px)`
              }}
            />
            <div
              className="text-[7px] font-mono font-bold px-1 py-0.5 rounded-l shrink-0 whitespace-nowrap"
              style={{
                backgroundColor: lv.projected ? lv.color + '15' : lv.color + '25',
                color: lv.color,
                borderLeft: `2px ${lv.projected ? 'dashed' : 'solid'} ${lv.color}`,
                opacity: lv.projected ? 0.85 : 1,
              }}
            >
              {typeLabel(lv.type, lv.projected)} {lv.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TradingView widget ────────────────────────────────────────────────────────
const TV_INTERVAL_MAP = { '1': '1', '2': '2', '3': '3', '5': '5', '15': '15', '30': '30', '60': '60' };
const ALPACA_TF_MAP   = { '1': '1Min', '2': '2Min', '3': '3Min', '5': '5Min', '15': '15Min', '30': '30Min', '60': '1Hour' };

// Use iframe embed instead of script injection to avoid DOM manipulation conflicts with React
function TradingViewChart({ ticker, interval, height }) {
  const tvInterval = TV_INTERVAL_MAP[interval] || '5';
  const src = `https://s.tradingview.com/widgetembed/?frameElementId=tv_${ticker}_${interval}&symbol=${encodeURIComponent(ticker)}&interval=${tvInterval}&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=131722&studies=%5B%22MASimple%40tv-basicstudies%22%2C%22RSI%40tv-basicstudies%22%5D&theme=dark&style=1&timezone=America%2FNew_York&locale=es`;

  return (
    <iframe
      key={`${ticker}-${interval}`}
      src={src}
      style={{ width: '100%', height, border: 'none', display: 'block' }}
      allowFullScreen
      title={`TradingView ${ticker}`}
    />
  );
}

// ── Intervals ─────────────────────────────────────────────────────────────────
const INTERVALS = [
  { label: '1m', value: '1' },
  { label: '2m', value: '2' },
  { label: '3m', value: '3' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function DayTradingChart({ ticker, analysisData }) {
  const [visible, setVisible] = useState({});
  const [interval, setInterval] = useState('5');
  const [collapsed, setCollapsed] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);

  const { bars, metrics, liveCandle, status, currentTicker, connect, disconnect } = useAlpacaStream();

  const groups = useMemo(() => getGroups(analysisData), [analysisData]);
  const visibleGroups = useMemo(() => {
    const result = {};
    groups.forEach(g => {
      result[g.key] = visible[g.key] !== undefined ? visible[g.key] : groupHasData(g);
    });
    return result;
  }, [groups, visible]);

  const toggle = (key) => setVisible(prev => ({ ...prev, [key]: !visibleGroups[key] }));
  const activeGroupsWithData = groups.filter(g => visibleGroups[g.key] && groupHasData(g));

  // Auto-connect when ticker changes
  useEffect(() => {
    if (ticker) {
      connect(ticker, ALPACA_TF_MAP[interval] || '5Min');
    }
    return () => {
      try {
        disconnect();
      } catch (_) {}
    };
  }, [ticker, disconnect]);

  // Reconnect on interval change
  const handleIntervalChange = (iv) => {
    setInterval(iv);
    if (ticker) connect(ticker, ALPACA_TF_MAP[iv] || '5Min');
  };

  const livePrice = metrics?.price;
  const liveIsBullish = !!liveCandle && liveCandle.c > liveCandle.o;
  const liveIsBearish = !!liveCandle && liveCandle.c < liveCandle.o;
  const CHART_HEIGHT = 480;

  const statusDot = {
    idle: { color: 'text-muted-foreground', label: 'Desconectado', icon: WifiOff },
    loading: { color: 'text-amber-400', label: 'Cargando...', icon: RefreshCw },
    connected: { color: 'text-emerald-400', label: 'En vivo (Alpaca IEX)', icon: Wifi },
    error: { color: 'text-red-400', label: 'Error conexión', icon: WifiOff },
  }[status] || { color: 'text-muted-foreground', label: '', icon: WifiOff };

  const StatusIcon = statusDot.icon;

  if (!ticker) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 bg-card">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-card flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-foreground">
            📊 Gráfico — <span className="text-primary font-mono">{ticker}</span>
          </span>
          <span className={`flex items-center gap-1 text-[9px] font-medium ${statusDot.color}`}>
            <StatusIcon className={`w-3 h-3 ${status === 'loading' ? 'animate-spin' : ''}`} />
            {statusDot.label}
          </span>
          {livePrice && (
            <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-400/10 px-2 py-0.5 rounded-full border border-sky-400/30">
              ${livePrice.toFixed(2)}
            </span>
          )}
          {liveCandle && (
            <span
              className={`text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                liveIsBullish
                  ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
                  : liveIsBearish
                    ? 'text-red-300 bg-red-500/10 border-red-500/30'
                    : 'text-amber-300 bg-amber-400/10 border-amber-400/30'
              }`}
            >
              ● Vela en formación O:{liveCandle.o?.toFixed?.(2)} H:{liveCandle.h?.toFixed?.(2)} L:{liveCandle.l?.toFixed?.(2)} C:{liveCandle.c?.toFixed?.(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Interval selector */}
          <div className="flex items-center gap-0.5">
            {INTERVALS.map(iv => (
              <button
                key={iv.value}
                onClick={() => handleIntervalChange(iv.value)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all ${
                  interval === iv.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>

          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}&interval=${TV_INTERVAL_MAP[interval]}`}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 transition-all"
          >
            <ExternalLink className="w-3 h-3" />TradingView
          </a>

          <button onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-foreground transition-colors">
            {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Strategy toggles */}
          <div className="px-4 py-2.5 bg-secondary/20 border-b border-border/20 flex flex-wrap items-center gap-2">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide shrink-0">Niveles:</span>
            {groups.map(g => {
              const hasData = groupHasData(g);
              const isOn = visibleGroups[g.key];
              return (
                <button
                  key={g.key}
                  onClick={() => hasData && toggle(g.key)}
                  disabled={!hasData}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                    !hasData ? 'opacity-30 cursor-not-allowed border-border/20 text-muted-foreground'
                      : isOn ? 'shadow-sm' : 'border-border/40 text-muted-foreground hover:text-foreground bg-transparent'
                  }`}
                  style={hasData && isOn ? { backgroundColor: g.color + '20', borderColor: g.color + '70', color: g.color } : {}}
                >
                  {hasData ? (isOn ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />) : <EyeOff className="w-3 h-3 opacity-40" />}
                  {g.label}
                </button>
              );
            })}

            {/* Metrics toggle */}
            <button
              onClick={() => setShowMetrics(v => !v)}
              className={`ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                showMetrics
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-400'
                  : 'border-border/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              📊 Métricas
            </button>
          </div>

          {/* Active level tags */}
          {activeGroupsWithData.length > 0 && (
            <div className="px-4 py-2 bg-secondary/10 border-b border-border/20 space-y-1.5">
              {activeGroupsWithData.map(g => <GroupLevels key={g.key} group={g} />)}
            </div>
          )}

          {/* Chart + ruler */}
          <div className="flex" style={{ height: CHART_HEIGHT }}>
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <TradingViewChart key={`${ticker}-${interval}`} ticker={ticker} interval={interval} height={CHART_HEIGHT} />
            </div>
            <PriceRuler activeGroups={activeGroupsWithData} livePrice={livePrice} />
          </div>

          {/* Live metrics panel from Alpaca stream */}
          {showMetrics && (
            <LiveMetricsPanel metrics={metrics} status={status} ticker={ticker} />
          )}
        </>
      )}
    </div>
  );
}