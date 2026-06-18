import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Zap, RefreshCw, Activity, Shield, Target, AlertTriangle, Bug } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';

const Check = ({ val, label }) => val
  ? <span className="flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle2 className="w-3 h-3" />{label}</span>
  : <span className="flex items-center gap-1 text-red-400 text-[10px]"><XCircle className="w-3 h-3" />{label}</span>;

const InfoRow = ({ label, value, color }) => (
  <div className="bg-secondary/30 rounded-lg px-2.5 py-1.5">
    <p className="text-[9px] text-muted-foreground">{label}</p>
    <p className={`text-[10px] ${color || 'text-foreground'}`}>{value}</p>
  </div>
);

function getLevelValue(strategy, keys = []) {
  for (const key of keys) {
    const value = strategy?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatUsd(value) {
  return value != null ? `$${value.toFixed(2)}` : 'N/A';
}

function formatDebugValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'N/A';
  return String(value);
}

function DebugPanel({ debug, show }) {
  if (!show || !debug || typeof debug !== 'object') return null;
  const entries = Object.entries(debug);
  if (!entries.length) return null;

  return (
    <div className="bg-slate-900/55 border border-slate-700/60 rounded-lg px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-sky-300 font-semibold mb-1.5">Debug condiciones</p>
      <div className="grid grid-cols-1 gap-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 text-[10px] font-mono">
            <span className="text-slate-300/90">{k}</span>
            <span className={`font-semibold ${typeof v === 'boolean' ? (v ? 'text-emerald-400' : 'text-red-400') : 'text-sky-300'}`}>
              {formatDebugValue(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StrategyCard({ icon: StratIcon, title, color, detected, children }) {
  const Icon = StratIcon;
  return (
    <Card className={`bg-card border-border/50 relative overflow-hidden ${!detected ? 'opacity-60' : ''}`}>
      <div className={`absolute top-0 left-0 w-full h-0.5 ${color}`} />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-primary" />
            {title}
          </span>
          {detected
            ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold">Detectado ✓</span>
            : <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">No detectado</span>
          }
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
      </CardContent>
    </Card>
  );
}

export default function StructurePatterns({ strategies, fallbackLevels = null }) {
  const [showDebug, setShowDebug] = useState(false);
  if (!strategies) return null;

  const { liquidity_sweep, pullback_trend, breakout_retest, volume_profile_reversion } = strategies;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">📐 Estrategias de Estructura</h3>
        <button
          onClick={() => setShowDebug((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border transition-colors ${
            showDebug
              ? 'bg-sky-500/15 border-sky-400/40 text-sky-300'
              : 'bg-secondary/20 border-border/40 text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bug className="w-3 h-3" />
          {showDebug ? 'Debug ON' : 'Debug OFF'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

        {/* 1. Pullback en Tendencia (4H→1H→15m) */}
        {pullback_trend && (
          <StrategyCard
            icon={RefreshCw}
            title="Tendencia + Pullback"
            color="bg-gradient-to-r from-primary/60 to-transparent"
            detected={pullback_trend.detected}
          >
            {pullback_trend.trend_direction && pullback_trend.trend_direction !== 'NEUTRAL' ? (
              <>
                <div className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2">
                  {pullback_trend.trend_direction === 'BULLISH'
                    ? <TrendingUp className="w-4 h-4 text-emerald-400" />
                    : <TrendingDown className="w-4 h-4 text-red-400" />
                  }
                  <div>
                    <p className="text-[9px] text-muted-foreground">Tendencia {pullback_trend.trend_tf || '4H'}</p>
                    <p className={`text-[11px] font-bold ${pullback_trend.trend_direction === 'BULLISH' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pullback_trend.trend_direction}
                    </p>
                  </div>
                  {pullback_trend.pullback_level && (
                    <div className="ml-auto text-right">
                      <p className="text-[9px] text-muted-foreground">{pullback_trend.pullback_level_type || 'Nivel pullback'}</p>
                      <p className="text-[11px] font-bold font-mono text-primary">${pullback_trend.pullback_level?.toFixed(2)}</p>
                    </div>
                  )}
                </div>
                {pullback_trend.ema_trend_4h && <InfoRow label="Tendencia 4H (EMAs)" value={pullback_trend.ema_trend_4h} />}
                {pullback_trend.pullback_1h && <InfoRow label="Pullback 1H" value={pullback_trend.pullback_1h} />}
                {pullback_trend.entry_trigger_15m && (
                  <InfoRow
                    label="Trigger Entrada 15min"
                    value={pullback_trend.entry_trigger_15m}
                    color={pullback_trend.entry_trigger_15m.includes('CONFIRMADA') ? 'text-emerald-400 font-semibold' : 'text-amber-400'}
                  />
                )}
                {pullback_trend.volume_on_pullback && <InfoRow label="Volumen en pullback" value={pullback_trend.volume_on_pullback} />}
                <div className="grid grid-cols-2 gap-1.5">
                  <Check val={pullback_trend.gamma_confluence} label="Gamma confluencia" />
                  <Check val={pullback_trend.vix_regime === 'LOW' || pullback_trend.vix_regime === 'MODERATE'} label={`VIX ${pullback_trend.vix_regime || 'N/A'}`} />
                </div>
                {pullback_trend.breakeven_rule && pullback_trend.breakeven_rule !== 'N/A — sin trade activo.' && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold flex items-center gap-1">
                      <Shield className="w-3 h-3" />Breakeven
                    </p>
                    <p className="text-[10px] text-amber-300">{pullback_trend.breakeven_rule}</p>
                  </div>
                )}
                {pullback_trend.direction && pullback_trend.direction !== 'NEUTRAL' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <SignalBadge signal={pullback_trend.direction} />
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${pullback_trend.trade_ready ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'}`}>
                      {pullback_trend.trade_ready ? 'Trade listo' : 'Setup en observación'}
                    </span>
                  </div>
                )}
                {pullback_trend.entry && <TradeLevels entry={pullback_trend.entry} stopLoss={pullback_trend.sl} takeProfit={pullback_trend.tp} direction={pullback_trend.direction} />}
                <ProbabilityBar label="Probabilidad" successPercent={pullback_trend.success_prob || 50} />
                {pullback_trend.blocked_reason && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold">Motivo principal</p>
                    <p className="text-[10px] text-amber-300">{pullback_trend.blocked_reason}</p>
                  </div>
                )}
                <DebugPanel debug={pullback_trend.debug} show={showDebug} />
                {pullback_trend.summary && <p className="text-[10px] text-muted-foreground">{pullback_trend.summary}</p>}
              </>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-[11px] text-muted-foreground">No hay pullback válido en tendencia actualmente.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Requiere: tendencia 4H clara → pullback a EMA 20 en 1H → vela envolvente en 15min</p>
                {pullback_trend.entry && (
                  <>
                    <div className="flex items-center justify-center">
                      <span className="text-[9px] px-2 py-0.5 rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10">
                        Niveles proyectados
                      </span>
                    </div>
                    <TradeLevels entry={pullback_trend.entry} stopLoss={pullback_trend.sl} takeProfit={pullback_trend.tp} direction={pullback_trend.direction} />
                  </>
                )}
              </div>
            )}
          </StrategyCard>
        )}

        {/* 2. Breakout */}
        {breakout_retest && (
          <StrategyCard
            icon={Activity}
            title="Breakout"
            color="bg-gradient-to-r from-cyan-500/60 to-transparent"
            detected={breakout_retest.detected}
          >
            {breakout_retest.detected ? (
              <>
                <div className="bg-secondary/40 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Nivel de ruptura</p>
                  <p className="text-sm font-bold font-mono text-cyan-400">
                    ${breakout_retest.breakout_level?.toFixed(2)}
                    {breakout_retest.breakout_level_type && <span className="text-[10px] text-muted-foreground ml-1">({breakout_retest.breakout_level_type})</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Check val={breakout_retest.volume_on_breakout} label="Volumen en ruptura" />
                  <Check val={breakout_retest.second_candle_confirms} label="2ª vela confirma" />
                  <Check val={breakout_retest.retest_occurred} label="Retest ocurrió" />
                  <Check val={breakout_retest.retest_held} label="Retest se mantuvo" />
                  <Check val={breakout_retest.gamma_confluence} label="Gamma confluencia" />
                  <Check val={!breakout_retest.false_breakout_filter} label="Sin falsa ruptura" />
                </div>
                {breakout_retest.false_breakout_filter && (
                  <div className="bg-red-500/10 rounded-lg px-2.5 py-1.5 border border-red-500/20">
                    <p className="text-[9px] text-red-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />Filtro de falsa ruptura activo
                    </p>
                    <p className="text-[10px] text-red-300">Precio retrocedió o volumen insuficiente — NO entrar.</p>
                  </div>
                )}
                {breakout_retest.direction && breakout_retest.direction !== 'NEUTRAL' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <SignalBadge signal={breakout_retest.direction} />
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${breakout_retest.trade_ready ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'}`}>
                      {breakout_retest.trade_ready ? 'Trade listo' : 'Setup en observación'}
                    </span>
                  </div>
                )}
                {breakout_retest.entry && <TradeLevels entry={breakout_retest.entry} stopLoss={breakout_retest.sl} takeProfit={breakout_retest.tp} direction={breakout_retest.direction} />}
                <ProbabilityBar label="Probabilidad" successPercent={breakout_retest.success_prob || 50} />
                {breakout_retest.blocked_reason && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold">Motivo principal</p>
                    <p className="text-[10px] text-amber-300">{breakout_retest.blocked_reason}</p>
                  </div>
                )}
                <DebugPanel debug={breakout_retest.debug} show={showDebug} />
                {breakout_retest.summary && <p className="text-[10px] text-muted-foreground">{breakout_retest.summary}</p>}
              </>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-[11px] text-muted-foreground">No se detecta breakout de nivel clave.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Requiere: ruptura de S/R en 1H + volumen alto + 2ª vela confirma</p>
                {breakout_retest.entry && (
                  <>
                    <div className="flex items-center justify-center">
                      <span className="text-[9px] px-2 py-0.5 rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10">
                        Niveles proyectados
                      </span>
                    </div>
                    <TradeLevels entry={breakout_retest.entry} stopLoss={breakout_retest.sl} takeProfit={breakout_retest.tp} direction={breakout_retest.direction} />
                  </>
                )}
              </div>
            )}
          </StrategyCard>
        )}

        {/* 3. Liquidity Sweep */}
        {liquidity_sweep && (
          <StrategyCard
            icon={Zap}
            title="Liquidity Sweep"
            color="bg-gradient-to-r from-amber-500/60 to-transparent"
            detected={liquidity_sweep.detected}
          >
            {liquidity_sweep.detected ? (
              <>
                <div className="bg-secondary/40 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Nivel barrido</p>
                  <p className="text-sm font-bold font-mono text-amber-400">
                    ${liquidity_sweep.swept_level?.toFixed(2)}
                    {liquidity_sweep.swept_level_type && <span className="text-[10px] text-muted-foreground ml-1">({liquidity_sweep.swept_level_type})</span>}
                  </p>
                  {liquidity_sweep.sweep_type && (
                    <p className="text-[10px] text-muted-foreground">
                      {liquidity_sweep.sweep_type === 'SWEEP_HIGH' ? '⬆️ Barrida de máximos → esperar caída' : '⬇️ Barrida de mínimos → esperar subida'}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Check val={liquidity_sweep.wick_rejection} label="Mecha rechazo" />
                  <Check val={liquidity_sweep.structure_shift} label="Cambio estructura" />
                  <Check val={liquidity_sweep.volume_confirms} label="Volumen confirma" />
                  <Check val={liquidity_sweep.gamma_confluence} label="Gamma confluencia" />
                </div>
                {!liquidity_sweep.structure_shift && liquidity_sweep.detected && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />Esperando confirmación
                    </p>
                    <p className="text-[10px] text-amber-300">Sweep detectado pero sin cambio de estructura — NO entrar aún.</p>
                  </div>
                )}
                {liquidity_sweep.direction && liquidity_sweep.direction !== 'NEUTRAL' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <SignalBadge signal={liquidity_sweep.direction} />
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${liquidity_sweep.trade_ready ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'}`}>
                      {liquidity_sweep.trade_ready ? 'Trade listo' : 'Setup en observación'}
                    </span>
                    {liquidity_sweep.timeframe_detected && (
                      <span className="text-[9px] text-muted-foreground">TF: {liquidity_sweep.timeframe_detected}</span>
                    )}
                  </div>
                )}
                {liquidity_sweep.entry && <TradeLevels entry={liquidity_sweep.entry} stopLoss={liquidity_sweep.sl} takeProfit={liquidity_sweep.tp} direction={liquidity_sweep.direction} />}
                <ProbabilityBar label="Probabilidad" successPercent={liquidity_sweep.success_prob || 50} />
                {liquidity_sweep.blocked_reason && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold">Motivo principal</p>
                    <p className="text-[10px] text-amber-300">{liquidity_sweep.blocked_reason}</p>
                  </div>
                )}
                <DebugPanel debug={liquidity_sweep.debug} show={showDebug} />
                {liquidity_sweep.summary && <p className="text-[10px] text-muted-foreground">{liquidity_sweep.summary}</p>}
              </>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-[11px] text-muted-foreground">No se detecta sweep de liquidez válido.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Requiere: máximos/mínimos iguales → ruptura momentánea → precio regresa → cambio de estructura</p>
                {liquidity_sweep.entry && (
                  <>
                    <div className="flex items-center justify-center">
                      <span className="text-[9px] px-2 py-0.5 rounded-full border text-amber-300 border-amber-500/40 bg-amber-500/10">
                        Niveles proyectados
                      </span>
                    </div>
                    <TradeLevels entry={liquidity_sweep.entry} stopLoss={liquidity_sweep.sl} takeProfit={liquidity_sweep.tp} direction={liquidity_sweep.direction} />
                  </>
                )}
              </div>
            )}
          </StrategyCard>
        )}

        {/* 4. Volume Profile Fixed Range */}
        {volume_profile_reversion && (
          <StrategyCard
            icon={Target}
            title="Volume Profile"
            color="bg-gradient-to-r from-fuchsia-500/60 to-transparent"
            detected={volume_profile_reversion.detected}
          >
            {(() => {
              const strategyEntry = getLevelValue(volume_profile_reversion, ['entry', 'entry_price']);
              const strategyStop = getLevelValue(volume_profile_reversion, ['sl', 'stop_loss']);
              const strategyTakeProfit = getLevelValue(volume_profile_reversion, ['tp', 'take_profit']);
              const fallbackEntry = getLevelValue(fallbackLevels, ['entry', 'entry_price']);
              const fallbackStop = getLevelValue(fallbackLevels, ['sl', 'stop_loss']);
              const fallbackTakeProfit = getLevelValue(fallbackLevels, ['tp', 'take_profit']);
              const vpEntry = strategyEntry ?? fallbackEntry;
              const vpStop = strategyStop ?? fallbackStop;
              const vpTakeProfit = strategyTakeProfit ?? fallbackTakeProfit;
              return volume_profile_reversion.detected ? (
              <>
                <div className="bg-secondary/40 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Perfil de rango fijo</p>
                  <p className="text-[10px] text-muted-foreground">
                    Setup: <span className="font-semibold text-foreground">{volume_profile_reversion.setup_type || 'N/A'}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Rango: {volume_profile_reversion.range_bars || 'N/A'} velas ({volume_profile_reversion.range_source || 'N/A'})
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <InfoRow label="POC" value={volume_profile_reversion.poc != null ? `$${volume_profile_reversion.poc.toFixed(2)}` : 'N/A'} color="text-fuchsia-300 font-semibold" />
                  <InfoRow label="VAH" value={volume_profile_reversion.vah != null ? `$${volume_profile_reversion.vah.toFixed(2)}` : 'N/A'} color="text-emerald-300 font-semibold" />
                  <InfoRow label="VAL" value={volume_profile_reversion.val != null ? `$${volume_profile_reversion.val.toFixed(2)}` : 'N/A'} color="text-cyan-300 font-semibold" />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <InfoRow label="Entrada" value={formatUsd(vpEntry)} color="text-sky-300 font-semibold" />
                  <InfoRow label="Stop" value={formatUsd(vpStop)} color="text-red-300 font-semibold" />
                  <InfoRow label="Take Profit" value={formatUsd(vpTakeProfit)} color="text-emerald-300 font-semibold" />
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <Check val={volume_profile_reversion.volume_impulse} label="Volumen impulso" />
                  <Check val={volume_profile_reversion.trade_ready} label="Setup válido" />
                  <Check val={(volume_profile_reversion.index_confluence || '0/3') !== '0/3'} label={`Índices ${volume_profile_reversion.index_confluence || '0/3'}`} />
                  <Check val={volume_profile_reversion.vix_regime !== 'EXTREME'} label={`VIX ${volume_profile_reversion.vix_regime || 'N/A'}`} />
                </div>

                {volume_profile_reversion.atr_15m != null && (
                  <InfoRow label="ATR 15m" value={`$${volume_profile_reversion.atr_15m.toFixed(2)}`} />
                )}

                {volume_profile_reversion.direction && volume_profile_reversion.direction !== 'NEUTRAL' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <SignalBadge signal={volume_profile_reversion.direction} />
                    <span className={`text-[9px] px-2 py-0.5 rounded-full border ${volume_profile_reversion.trade_ready ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-amber-300 border-amber-500/40 bg-amber-500/10'}`}>
                      {volume_profile_reversion.trade_ready ? 'Trade listo' : 'Setup en observación'}
                    </span>
                  </div>
                )}

                {vpEntry != null && (
                  <TradeLevels
                    entry={vpEntry}
                    stopLoss={vpStop}
                    takeProfit={vpTakeProfit}
                    direction={volume_profile_reversion.direction}
                  />
                )}

                <ProbabilityBar label="Probabilidad" successPercent={volume_profile_reversion.success_prob || 50} />

                {volume_profile_reversion.blocked_reason && (
                  <div className="bg-amber-500/10 rounded-lg px-2.5 py-1.5 border border-amber-500/20">
                    <p className="text-[9px] text-amber-400 font-semibold">Motivo principal</p>
                    <p className="text-[10px] text-amber-300">{volume_profile_reversion.blocked_reason}</p>
                  </div>
                )}

                <DebugPanel debug={volume_profile_reversion.debug} show={showDebug} />
                {volume_profile_reversion.summary && <p className="text-[10px] text-muted-foreground">{volume_profile_reversion.summary}</p>}
              </>
            ) : (
              <div className="text-center py-4 space-y-2">
                <p className="text-[11px] text-muted-foreground">No hay setup activo en Perfil de Volumen.</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">Requiere: reacción en POC/VAH/VAL con confirmación de volumen y contexto.</p>
                {volume_profile_reversion.poc != null && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <InfoRow label="POC" value={`$${volume_profile_reversion.poc.toFixed(2)}`} color="text-fuchsia-300 font-semibold" />
                    <InfoRow label="VAH" value={volume_profile_reversion.vah != null ? `$${volume_profile_reversion.vah.toFixed(2)}` : 'N/A'} color="text-emerald-300 font-semibold" />
                    <InfoRow label="VAL" value={volume_profile_reversion.val != null ? `$${volume_profile_reversion.val.toFixed(2)}` : 'N/A'} color="text-cyan-300 font-semibold" />
                  </div>
                )}
                {(vpEntry != null || vpStop != null || vpTakeProfit != null) && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <InfoRow label="Entrada" value={formatUsd(vpEntry)} color="text-sky-300 font-semibold" />
                    <InfoRow label="Stop" value={formatUsd(vpStop)} color="text-red-300 font-semibold" />
                    <InfoRow label="Take Profit" value={formatUsd(vpTakeProfit)} color="text-emerald-300 font-semibold" />
                  </div>
                )}
              </div>
            );
            })()}
          </StrategyCard>
        )}

      </div>
    </div>
  );
}