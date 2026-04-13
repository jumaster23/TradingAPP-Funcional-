import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus, Target, Wind, Clock, ArrowRight, Shield, Calendar, AlertTriangle, BarChart3, FileText } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import ProbabilityBar from '../trading/ProbabilityBar';

const Check = ({ val, label }) => val
  ? <span className="flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle2 className="w-3 h-3" />{label}</span>
  : <span className="flex items-center gap-1 text-red-400/80 text-[10px]"><XCircle className="w-3 h-3" />{label}</span>;

const dirIcon = (d) => d === 'BULLISH'
  ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
  : d === 'BEARISH'
    ? <TrendingDown className="w-3.5 h-3.5 text-red-400" />
    : <Minus className="w-3.5 h-3.5 text-amber-400" />;

const dirColor = (d) => d === 'BULLISH' ? 'text-emerald-400' : d === 'BEARISH' ? 'text-red-400' : 'text-amber-400';

function LayerCard({ icon: LayerIcon, iconColor, title, subtitle, children, highlight }) {
  const Icon = LayerIcon;
  return (
    <div className={`rounded-xl border ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border/40 bg-secondary/20'} overflow-hidden`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${highlight ? 'bg-primary/10' : 'bg-secondary/40'} border-b border-border/30`}>
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        <span className={`text-[11px] font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>{title}</span>
        <span className="text-[9px] text-muted-foreground ml-1">— {subtitle}</span>
      </div>
      <div className="p-3 space-y-2">
        {children}
      </div>
    </div>
  );
}

export default function LeapsModule({ data }) {
  if (!data) return null;

  const { signal, daily, macro, confirmation, fundamentals, gamma_oi, options_contract, vix_context, success_prob, summary, entry_price, stop_loss, take_profit, risk, expiration, current_price, setup_grade, entry_alert, execution_tier, size_guidance } = data;

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500/60 via-primary/40 to-transparent" />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Target className="w-4 h-4 text-purple-400" />
            LEAPS — Análisis Multi-Timeframe
            <span className="text-[9px] text-muted-foreground font-normal">(Diario → Semanal → Mensual)</span>
          </span>
          <div className="flex items-center gap-2">
            <SignalBadge signal={signal} />
            {setup_grade && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${setup_grade === 'A+' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : setup_grade === 'B+' ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' : setup_grade === 'B' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                Setup {setup_grade}
              </span>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {(entry_alert || execution_tier) && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
            <p className="text-[10px] font-semibold text-amber-300">Alerta de entrada</p>
            <p className="text-[10px] text-amber-200 mt-1">{entry_alert || 'La tesis LEAPS es operable, pero no con calidad A+.'}</p>
            {(size_guidance || execution_tier) && (
              <p className="text-[9px] text-amber-200/90 mt-1">{size_guidance || `Tamaño sugerido: ${execution_tier}.`}</p>
            )}
          </div>
        )}

        {/* 3-layer structure */}
        <div className="space-y-3">

          {/* CAPA 1: PRINCIPAL — Diario */}
          <LayerCard icon={Target} iconColor="text-primary" title="PRINCIPAL" subtitle="Temporalidad Diaria — Análisis técnico principal" highlight>
            <div className="grid grid-cols-4 gap-2 mb-2">
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">EMA 50</p>
                <p className="text-[11px] font-bold font-mono text-foreground">
                  {daily?.ema50_value ? `$${daily.ema50_value.toFixed(2)}` : '--'}
                </p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">EMA 200</p>
                <p className="text-[11px] font-bold font-mono text-foreground">
                  {daily?.ema200_value ? `$${daily.ema200_value.toFixed(2)}` : '--'}
                </p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">RSI(14)</p>
                <p className={`text-[11px] font-bold font-mono ${
                  daily?.rsi_in_ideal_zone ? 'text-emerald-400'
                  : daily?.rsi_overbought ? 'text-red-400'
                  : daily?.rsi_weak ? 'text-amber-400'
                  : 'text-foreground'
                }`}>{daily?.rsi_value?.toFixed(1) || '--'}</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">Volumen</p>
                <p className={`text-[11px] font-bold ${daily?.volume_growing_on_breakout ? 'text-emerald-400' : 'text-red-400'}`}>
                  {daily?.volume_growing_on_breakout ? 'Creciente ✓' : 'Bajo ✗'}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">EMAs y señales de cruce</p>
              <div className="grid grid-cols-1 gap-1">
                <Check val={daily?.price_above_both_emas} label="Precio sobre EMA 50 y EMA 200" />
                <Check val={daily?.golden_cross} label="Golden Cross (MA50 cruza EMA200 al alza)" />
                {daily?.death_cross && <Check val={daily?.death_cross} label="Death Cross (MA50 cruza EMA200 a la baja)" />}
              </div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mt-2">RSI y fuerza</p>
              <div className="grid grid-cols-1 gap-1">
                <Check val={daily?.rsi_in_ideal_zone} label={`RSI en zona ideal 50-70 (actual: ${daily?.rsi_value?.toFixed(0) || '--'})`} />
                {daily?.rsi_overbought && <Check val={false} label="⚠️ RSI en sobrecompra (>70)" />}
                {daily?.rsi_weak && <Check val={false} label="RSI débil (<50)" />}
                <Check val={daily?.volume_growing_on_breakout} label="Volumen institucional creciente en rompimientos" />
              </div>
              {daily?.volume_note && <p className="text-[9px] text-muted-foreground italic mt-1">{daily.volume_note}</p>}
              {daily?.daily_note && <p className="text-[9px] text-muted-foreground italic mt-1">{daily.daily_note}</p>}
            </div>
          </LayerCard>

          {/* Arrow connector */}
          <div className="flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
          </div>

          {/* CAPA 2: MACRO — Semanal */}
          <LayerCard icon={TrendingUp} iconColor="text-cyan-400" title="MACRO" subtitle="Temporalidad Semanal — Dirección de largo plazo">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground mb-1">Tendencia Semanal</p>
                <div className="flex items-center justify-center gap-1">
                  {dirIcon(macro?.weekly_trend)}
                  <span className={`text-[11px] font-bold ${dirColor(macro?.weekly_trend)}`}>{macro?.weekly_trend || '--'}</span>
                </div>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground mb-1">Estructura</p>
                <p className="text-[10px] font-semibold text-foreground">{macro?.weekly_structure || '--'}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-1 gap-1">
                <Check val={macro?.price_above_ema200_weekly} label="Precio sobre EMA 200 semanal" />
                <Check val={macro?.ema50_above_ema200_weekly} label="EMA 50 sobre EMA 200 semanal" />
                <Check val={macro?.higher_highs_weekly} label="Máximos crecientes en semanal" />
                {macro?.lower_lows_weekly && <Check val={macro?.lower_lows_weekly} label="Mínimos decrecientes (estructura bajista)" />}
              </div>
              {macro?.weekly_note && <p className="text-[9px] text-muted-foreground italic mt-1">{macro.weekly_note}</p>}
            </div>
          </LayerCard>

          {/* Arrow connector */}
          <div className="flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-muted-foreground/40 rotate-90" />
          </div>

          {/* CAPA 3: CONFIRMACIÓN — Mensual */}
          <LayerCard icon={Clock} iconColor="text-amber-400" title="CONFIRMACIÓN" subtitle="Temporalidad Mensual — Ultra largo plazo">
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">Tendencia</p>
                <div className="flex items-center justify-center gap-1">
                  {dirIcon(confirmation?.monthly_trend)}
                  <span className={`text-[11px] font-bold ${dirColor(confirmation?.monthly_trend)}`}>{confirmation?.monthly_trend || '--'}</span>
                </div>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">RSI Mensual</p>
                <p className={`text-[11px] font-bold font-mono ${
                  confirmation?.monthly_rsi >= 50 && confirmation?.monthly_rsi <= 70 ? 'text-emerald-400'
                  : confirmation?.monthly_rsi < 40 ? 'text-red-400'
                  : 'text-amber-400'
                }`}>{confirmation?.monthly_rsi?.toFixed(1) || '--'}</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] text-muted-foreground">EMA 50</p>
                <p className={`text-[11px] font-bold ${confirmation?.monthly_above_ema50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {confirmation?.monthly_above_ema50 ? 'Sobre ✓' : 'Bajo ✗'}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <Check val={confirmation?.monthly_above_ema50} label="Precio sobre EMA 50 mensual" />
              <Check val={confirmation?.breaks_ath} label="Rompiendo/cerca de máximos históricos (ATH)" />
              {confirmation?.breaks_strong_support && <Check val={confirmation?.breaks_strong_support} label="Rompimiento de soporte fuerte mensual" />}
              {confirmation?.monthly_structure && <p className="text-[10px] text-foreground mt-1">{confirmation.monthly_structure}</p>}
              {confirmation?.monthly_note && <p className="text-[9px] text-muted-foreground italic mt-1">{confirmation.monthly_note}</p>}
            </div>
          </LayerCard>
        </div>

        {/* FUNDAMENTALS */}
        {fundamentals && (
          <div className={`rounded-xl border ${fundamentals.fundamentals_pass ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'} overflow-hidden`}>
            <div className={`flex items-center gap-2 px-3 py-2 ${fundamentals.fundamentals_pass ? 'bg-emerald-500/10' : 'bg-red-500/10'} border-b ${fundamentals.fundamentals_pass ? 'border-emerald-500/20' : 'border-red-500/20'}`}>
              <BarChart3 className={`w-3.5 h-3.5 ${fundamentals.fundamentals_pass ? 'text-emerald-400' : 'text-red-400'}`} />
              <span className={`text-[11px] font-bold ${fundamentals.fundamentals_pass ? 'text-emerald-400' : 'text-red-400'}`}>
                Análisis Fundamental {fundamentals.fundamentals_pass ? '✓ APROBADO' : '✗ NO APROBADO'}
              </span>
              {fundamentals.sector_name && (
                <span className="ml-auto text-[9px] text-muted-foreground">Sector: <span className="text-foreground font-semibold">{fundamentals.sector_name}</span></span>
              )}
            </div>
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <Check val={fundamentals.revenue_growth} label="Revenue Growth" />
                </div>
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <Check val={fundamentals.eps_positive} label="EPS Positivo" />
                </div>
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <Check val={fundamentals.sector_strength} label="Sector Fuerte" />
                </div>
              </div>
              {fundamentals.fundamentals_summary && <p className="text-[9px] text-muted-foreground">{fundamentals.fundamentals_summary}</p>}
            </div>
          </div>
        )}

        {/* OPTIONS CONTRACT */}
        {options_contract && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border-b border-purple-500/20">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-[11px] font-bold text-purple-400">Especificaciones del Contrato LEAPS</span>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {options_contract.expiration && (
                  <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                    <p className="text-[9px] text-muted-foreground">Expiración</p>
                    <p className="text-[11px] font-bold text-purple-400">{options_contract.expiration}</p>
                  </div>
                )}
                {options_contract.delta != null && (
                  <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                    <p className="text-[9px] text-muted-foreground">Delta</p>
                    <p className="text-[11px] font-bold text-foreground">{options_contract.delta}</p>
                  </div>
                )}
                {options_contract.strike_suggestion && (
                  <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                    <p className="text-[9px] text-muted-foreground">Strike</p>
                    <p className="text-[10px] font-bold text-foreground">{options_contract.strike_suggestion}</p>
                  </div>
                )}
                {options_contract.max_spread && (
                  <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                    <p className="text-[9px] text-muted-foreground">Spread Máx.</p>
                    <p className="text-[11px] font-bold text-foreground">{options_contract.max_spread}</p>
                  </div>
                )}
              </div>
              {options_contract.note && <p className="text-[9px] text-muted-foreground mt-2">{options_contract.note}</p>}
            </div>
          </div>
        )}

        {/* GAMMA & OI */}
        {gamma_oi && (
          <div className="flex items-start gap-2 bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <TrendingUp className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Gamma & Open Interest</p>
              {gamma_oi.gamma_levels && <p className="text-[10px] text-foreground">Gamma: {gamma_oi.gamma_levels}</p>}
              {gamma_oi.max_pain != null && <p className="text-[10px] text-foreground">Max Pain: ${gamma_oi.max_pain}</p>}
              {gamma_oi.oi_note && <p className="text-[9px] text-muted-foreground">{gamma_oi.oi_note}</p>}
            </div>
          </div>
        )}

        {/* VIX Context */}
        {vix_context && (
          <div className="flex items-start gap-2 bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">VIX — Contexto de Mercado</p>
              <p className="text-[10px] text-foreground">{vix_context}</p>
            </div>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
            <p className="text-[10px] text-foreground">{summary}</p>
          </div>
        )}

        {/* Precio actual del stock — siempre visible */}
        <div className="flex items-center gap-3 bg-secondary/40 rounded-xl px-4 py-3 border border-border/40">
          <div className="flex-1">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Precio Actual del Stock</p>
            <p className="text-2xl font-bold font-mono text-foreground">
              {current_price ? `$${current_price.toFixed(2)}` : <span className="text-muted-foreground text-base">Cargando...</span>}
            </p>
          </div>
          {current_price && entry_price && (
            <div className="text-right">
              <p className="text-[9px] text-muted-foreground">vs Entrada</p>
              <p className={`text-sm font-bold ${entry_price <= current_price ? 'text-emerald-400' : 'text-amber-400'}`}>
                {entry_price <= current_price ? '▼' : '▲'} {Math.abs(((entry_price - current_price) / current_price) * 100).toFixed(1)}% {entry_price <= current_price ? 'descuento' : 'sobre precio actual'}
              </p>
            </div>
          )}
        </div>

        {/* Trade Levels */}
        <div className="rounded-xl border border-border/40 bg-secondary/20 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border/30">
            <Target className="w-3.5 h-3.5 text-primary" />
            <span className="text-[11px] font-bold text-foreground">Niveles de Trade</span>
            {expiration?.suggested && (
              <span className="ml-auto flex items-center gap-1 text-[9px] text-purple-400 font-semibold">
                <Calendar className="w-3 h-3" />Vencimiento: {expiration.suggested}
              </span>
            )}
          </div>
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-primary/8 rounded-lg p-2.5 text-center border border-primary/20">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Entrada</p>
                <p className="text-base font-bold font-mono text-primary">{entry_price ? `$${entry_price.toFixed(2)}` : '--'}</p>
                {expiration?.entry_note && <p className="text-[8px] text-muted-foreground mt-0.5">{expiration.entry_note}</p>}
              </div>
              <div className="bg-red-500/8 rounded-lg p-2.5 text-center border border-red-500/20">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Stop Loss</p>
                <p className="text-base font-bold font-mono text-red-400">{stop_loss ? `$${stop_loss.toFixed(2)}` : '--'}</p>
                {entry_price && stop_loss && (
                  <p className="text-[8px] text-muted-foreground mt-0.5">
                    -{((Math.abs(entry_price - stop_loss) / entry_price) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
              <div className="bg-emerald-500/8 rounded-lg p-2.5 text-center border border-emerald-500/20">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Take Profit</p>
                <p className="text-base font-bold font-mono text-emerald-400">{take_profit ? `$${take_profit.toFixed(2)}` : '--'}</p>
                {entry_price && take_profit && (
                  <p className="text-[8px] text-muted-foreground mt-0.5">
                    +{((Math.abs(take_profit - entry_price) / entry_price) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
            {entry_price && stop_loss && take_profit && (
              <div className="flex items-center justify-center gap-2 bg-secondary/40 rounded-lg px-3 py-1.5">
                <span className="text-[9px] text-muted-foreground">R:R Ratio</span>
                <span className="text-sm font-bold text-primary">
                  1:{(Math.abs(take_profit - entry_price) / Math.abs(entry_price - stop_loss)).toFixed(2)}
                </span>
                <span className="text-[9px] text-muted-foreground ml-2">Horizonte: <span className="text-foreground font-semibold">{expiration?.horizon || '6–18 meses'}</span></span>
              </div>
            )}
          </div>
        </div>

        {/* Risk Manager */}
        {risk && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-bold text-amber-400">Risk Manager LEAPS</span>
            </div>
            <div className="p-3 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Riesgo Máx.</p>
                  <p className="text-sm font-bold text-amber-400">{risk.max_risk_pct ? `${risk.max_risk_pct}%` : '--'}</p>
                </div>
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[9px] text-muted-foreground">R:R Objetivo</p>
                  <p className="text-sm font-bold text-primary">{risk.rr_ratio || '--'}</p>
                </div>
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Tamaño Posición</p>
                  <p className="text-[10px] font-semibold text-foreground leading-tight">{risk.position_size || '--'}</p>
                </div>
                <div className="bg-secondary/40 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Parciales en</p>
                  <p className="text-[10px] font-semibold text-emerald-400 leading-tight">{risk.partial_exit || '--'}</p>
                </div>
              </div>

              {risk.breakeven_trigger && (
                <div className="flex items-start gap-2 bg-cyan-500/8 rounded-lg p-2 border border-cyan-500/20">
                  <Shield className="w-3 h-3 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[9px] text-cyan-400 font-semibold">Mover SL a Breakeven cuando:</p>
                    <p className="text-[9px] text-foreground">{risk.breakeven_trigger}</p>
                  </div>
                </div>
              )}

              {risk.invalidation && (
                <div className="flex items-start gap-2 bg-red-500/8 rounded-lg p-2 border border-red-500/20">
                  <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[9px] text-red-400 font-semibold">Invalidación — salir inmediatamente:</p>
                    <p className="text-[9px] text-foreground">{risk.invalidation}</p>
                  </div>
                </div>
              )}

              {risk.general_note && (
                <div className="bg-secondary/30 rounded-lg px-2.5 py-2 border border-border/30">
                  <p className="text-[9px] text-muted-foreground">{risk.general_note}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <ProbabilityBar label="Probabilidad LEAPS" successPercent={success_prob || 50} />
      </CardContent>
    </Card>
  );
}