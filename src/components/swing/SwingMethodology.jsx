import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus, ArrowRight, BarChart2, Target, Zap, Wind, GitMerge, Layers, Shield } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';

const Check = ({ val, label }) => val
  ? <span className="flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle2 className="w-3 h-3 shrink-0" />{label}</span>
  : <span className="flex items-center gap-1 text-red-400/80 text-[10px]"><XCircle className="w-3 h-3 shrink-0" />{label}</span>;

const dirIcon = (d) => d === 'BULLISH'
  ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
  : d === 'BEARISH'
    ? <TrendingDown className="w-3.5 h-3.5 text-red-400" />
    : <Minus className="w-3.5 h-3.5 text-amber-400" />;

const dirColor = (d) => d === 'BULLISH' ? 'text-emerald-400' : d === 'BEARISH' ? 'text-red-400' : 'text-amber-400';

function Layer({ icon: LayerIcon, iconColor, title, subtitle, children, isEntry }) {
  const Icon = LayerIcon;
  return (
    <div className={`rounded-xl border overflow-hidden ${isEntry ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-secondary/20'}`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-border/30 ${isEntry ? 'bg-primary/10' : 'bg-secondary/40'}`}>
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        <span className={`text-[11px] font-bold ${isEntry ? 'text-primary' : 'text-foreground'}`}>{title}</span>
        <span className="text-[9px] text-muted-foreground ml-1">— {subtitle}</span>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

export default function SwingMethodology({ data }) {
  if (!data) return null;

  const { signal, daily, tf4h, tf1h, context, risk, entry_price, stop_loss, take_profit, success_prob, summary } = data;

  const passCount = [
    daily?.price_above_ema200, daily?.ema50_above_ema200, daily?.rsi_in_zone, daily?.trend_clear,
    tf4h?.pullback_to_ema50 ?? tf4h?.pullback_to_resistance, tf4h?.support_respected ?? tf4h?.no_bearish_break,
    tf1h?.strong_candle, tf1h?.volume_confirms
  ].filter(Boolean).length;

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/70 via-cyan-400/40 to-transparent" />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary" />
            Swing — Metodología Multi-Timeframe
            <span className="text-[9px] text-muted-foreground font-normal">(Diario → 4h → 1h)</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{passCount}/8 checks</span>
            <SignalBadge signal={signal} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* ══ LAYER 1: DIARIO ══ */}
        <Layer icon={TrendingUp} iconColor="text-cyan-400" title="TENDENCIA PRINCIPAL" subtitle="Temporalidad Diaria — Dirección y Estructura">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">EMA 200</p>
              <p className="text-[11px] font-bold font-mono text-foreground">{daily?.ema200 ? `$${daily.ema200.toFixed(2)}` : '--'}</p>
            </div>
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">EMA 50</p>
              <p className="text-[11px] font-bold font-mono text-foreground">{daily?.ema50 ? `$${daily.ema50.toFixed(2)}` : '--'}</p>
            </div>
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">RSI(14)</p>
              <p className={`text-[11px] font-bold font-mono ${
                daily?.rsi >= 50 && daily?.rsi <= 70 ? 'text-emerald-400' : daily?.rsi < 40 ? 'text-red-400' : 'text-amber-400'
              }`}>{daily?.rsi?.toFixed(1) || '--'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2">
            {dirIcon(daily?.trend)}
            <span className={`text-[11px] font-bold ${dirColor(daily?.trend)}`}>{daily?.trend || '--'}</span>
            {daily?.structure && <span className="text-[9px] text-muted-foreground ml-1">— {daily.structure}</span>}
          </div>

          {signal === 'CALL' ? (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide">CALL — Condiciones diarias</p>
              <Check val={daily?.price_above_ema200} label="Precio sobre EMA 200 diario" />
              <Check val={daily?.ema50_above_ema200} label="EMA 50 sobre EMA 200 (tendencia alcista confirmada)" />
              <Check val={daily?.rsi_in_zone} label={`RSI 50–70 zona óptima (actual: ${daily?.rsi?.toFixed(0) || '--'})`} />
              <Check val={daily?.trend_clear} label="Tendencia alcista clara (máximos y mínimos crecientes)" />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide">PUT — Condiciones diarias</p>
              <Check val={daily?.price_below_ema200} label="Precio bajo EMA 200 diario" />
              <Check val={daily?.ema50_below_ema200} label="EMA 50 bajo EMA 200 (tendencia bajista confirmada)" />
              <Check val={daily?.rsi_weak} label={`RSI débil <50 (actual: ${daily?.rsi?.toFixed(0) || '--'})`} />
              <Check val={daily?.bearish_trend} label="Tendencia bajista activa (máximos y mínimos decrecientes)" />
            </div>
          )}
          {daily?.note && <p className="text-[9px] text-muted-foreground italic mt-1 pt-1 border-t border-border/20">{daily.note}</p>}
        </Layer>

        <div className="flex items-center justify-center">
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
        </div>

        {/* ══ LAYER 2: 4H ══ */}
        <Layer icon={Target} iconColor="text-amber-400" title="CONFIRMACIÓN" subtitle="4 Horas — Pullback y Setup">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">EMA 50 (4h)</p>
              <p className="text-[11px] font-bold font-mono">{tf4h?.ema50 ? `$${tf4h.ema50.toFixed(2)}` : '--'}</p>
            </div>
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">Estado</p>
              <p className={`text-[10px] font-bold ${
                tf4h?.status === 'PULLBACK' ? 'text-amber-400' : tf4h?.status === 'READY' ? 'text-emerald-400' : 'text-muted-foreground'
              }`}>{tf4h?.status || '--'}</p>
            </div>
          </div>

          {signal === 'CALL' ? (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide">CALL — Confirmación 4h</p>
              <Check val={tf4h?.pullback_to_ema50} label="Pullback a EMA 50 en 4h (zona de entrada)" />
              <Check val={tf4h?.support_respected} label="Soporte respetado, no ruptura bajista" />
              <Check val={tf4h?.no_bearish_break} label="Sin ruptura bajista de estructura en 4h" />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide">PUT — Confirmación 4h</p>
              <Check val={tf4h?.pullback_to_resistance} label="Pullback a resistencia en 4h" />
              <Check val={tf4h?.resistance_holding} label="Resistencia se mantiene, no ruptura alcista" />
              <Check val={tf4h?.bearish_pressure} label="Presión bajista visible en 4h" />
            </div>
          )}
          {tf4h?.note && <p className="text-[9px] text-muted-foreground italic mt-1 pt-1 border-t border-border/20">{tf4h.note}</p>}
        </Layer>

        <div className="flex items-center justify-center">
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
        </div>

        {/* ══ LAYER 3: 1H — ENTRY ══ */}
        <Layer icon={Zap} iconColor="text-primary" title="ENTRADA PRECISA" subtitle="1 Hora — Trigger exacto" isEntry>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">Micro nivel</p>
              <p className="text-[11px] font-bold font-mono">{tf1h?.micro_level ? `$${tf1h.micro_level.toFixed(2)}` : '--'}</p>
            </div>
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">Volumen</p>
              <p className={`text-[10px] font-bold ${tf1h?.volume_confirms ? 'text-emerald-400' : 'text-red-400'}`}>
                {tf1h?.volume_confirms ? 'Alto ✓' : 'Bajo ✗'}
              </p>
            </div>
            <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
              <p className="text-[9px] text-muted-foreground">Entrada</p>
              <p className={`text-[10px] font-bold ${tf1h?.ready ? 'text-emerald-400' : 'text-amber-400'}`}>
                {tf1h?.ready ? '✅ Lista' : '⏳ Esperar'}
              </p>
            </div>
          </div>

          {signal === 'CALL' ? (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide">CALL — Trigger en 1h</p>
              <Check val={tf1h?.strong_bullish_candle} label="Vela alcista fuerte (cuerpo definido, cierre alto)" />
              <Check val={tf1h?.micro_resistance_break} label="Ruptura de micro resistencia en 1h" />
              <Check val={tf1h?.volume_confirms} label="Volumen alto en la ruptura (confirma convicción)" />
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-red-400 uppercase tracking-wide">PUT — Trigger en 1h</p>
              <Check val={tf1h?.rejection_candle} label="Vela de rechazo desde resistencia (mecha larga)" />
              <Check val={tf1h?.volume_confirms} label="Volumen alto en el rechazo" />
              <Check val={tf1h?.bearish_entry_confirmed} label="Confirmación bajista en 1h (cierre bajo mínimo previo)" />
            </div>
          )}
          {tf1h?.note && <p className="text-[9px] text-muted-foreground italic mt-1 pt-1 border-t border-border/20">{tf1h.note}</p>}
        </Layer>

        {/* ══ CONTEXT: SPX + VIX + GAMMA ══ */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* SPX */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-1.5">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <GitMerge className="w-3 h-3 text-purple-400" />SPX-500 Context
            </p>
            <div className="flex items-center gap-1">
              {dirIcon(context?.spx_direction)}
              <span className={`text-[11px] font-bold ${dirColor(context?.spx_direction)}`}>{context?.spx_direction || '--'}</span>
            </div>
            {context?.spx_note && <p className="text-[9px] text-muted-foreground leading-tight">{context.spx_note}</p>}
          </div>

          {/* VIX */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-1.5">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Wind className="w-3 h-3 text-cyan-400" />VIX
            </p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-foreground">{context?.vix_value?.toFixed(1) || '--'}</span>
              <span className={`text-[10px] font-bold ${
                context?.vix_regime === 'LOW' ? 'text-emerald-400' :
                context?.vix_regime === 'HIGH' || context?.vix_regime === 'EXTREME' ? 'text-red-400' : 'text-amber-400'
              }`}>{context?.vix_regime || '--'}</span>
            </div>
            {context?.vix_note && <p className="text-[9px] text-muted-foreground leading-tight">{context.vix_note}</p>}
          </div>

          {/* Gamma / OI */}
          <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-1.5">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Layers className="w-3 h-3 text-cyan-400" />Gamma / OI
            </p>
            <div className="space-y-0.5 text-[10px] font-mono">
              {context?.call_wall && <p className="text-emerald-400">Call Wall: ${context.call_wall.toFixed(2)}</p>}
              {context?.gamma_level && <p className="text-cyan-400">Gamma: ${context.gamma_level.toFixed(2)}</p>}
              {context?.put_wall && <p className="text-red-400">Put Wall: ${context.put_wall.toFixed(2)}</p>}
            </div>
            {context?.gamma_note && <p className="text-[9px] text-muted-foreground leading-tight">{context.gamma_note}</p>}
          </div>
        </div>

        {/* ══ RISK MANAGEMENT ══ */}
        {risk && (
          <div className="rounded-xl border border-border/40 bg-secondary/20 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border/30">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-bold text-foreground">Gestión de Riesgo</span>
            </div>
            <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">Riesgo Máx.</p>
                <p className="text-sm font-bold text-amber-400">{risk.max_risk_pct}%</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">R:R Ratio</p>
                <p className="text-sm font-bold text-primary">{risk.rr_ratio}</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">SL a BE cuando</p>
                <p className="text-[10px] font-semibold text-foreground leading-tight">{risk.breakeven_trigger || '--'}</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">Posición</p>
                <p className="text-[10px] font-semibold text-foreground leading-tight">{risk.position_suggestion || '--'}</p>
              </div>
            </div>
            {risk.invalidation && (
              <div className="mx-3 mb-3 bg-red-500/8 rounded-lg px-2.5 py-1.5 border border-red-500/20">
                <p className="text-[9px] text-red-400 font-semibold">Invalidación: <span className="text-foreground font-normal">{risk.invalidation}</span></p>
              </div>
            )}
          </div>
        )}

        {/* Summary + Levels */}
        {summary && (
          <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <p className="text-[10px] text-foreground">{summary}</p>
          </div>
        )}
        <TradeLevels entry={entry_price} stopLoss={stop_loss} takeProfit={take_profit} direction={signal} />
        <ProbabilityBar label="Probabilidad de Éxito Swing" successPercent={success_prob || 50} />
      </CardContent>
    </Card>
  );
}