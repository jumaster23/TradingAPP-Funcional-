import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import TradeLevels from '../trading/TradeLevels';
import { ArrowUpRight, ArrowDownRight, CheckCircle2, Clock, AlertCircle, Database, BarChart2, TrendingDown, TrendingUp, Zap, Wind, Activity, GitMerge } from 'lucide-react';

const gapScale = [
  { pct: '25%', key: 'fill_probability_25', fallback: 100 },
  { pct: '50%', key: 'fill_probability_50', fallback: 75 },
  { pct: '75%', key: 'fill_probability_75', fallback: 50 },
  { pct: '100%', key: 'fill_probability_100', fallback: 30 },
];

const fillStatusConfig = {
  filled_100: { label: 'GAP LLENADO 100%', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle2 },
  filling: { label: 'LLENANDO...', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', icon: Clock },
  unfilled: { label: 'SIN LLENAR', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30', icon: AlertCircle },
};

export default function GapAnalysis({ data }) {
  if (!data) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader><CardTitle className="text-sm">Gap Analysis</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">Analiza un ticker para ver el gap</CardContent>
      </Card>
    );
  }

  const gapDirection = data.gap_size_usd > 0 ? 'UP' : 'DOWN';
  const statusKey = data.fill_status || 'unfilled';
  const status = fillStatusConfig[statusKey] || fillStatusConfig.unfilled;
  const StatusIcon = status.icon;
  const isFilled = statusKey === 'filled_100';

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {gapDirection === 'UP' ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
          Gap Analysis — {data.gap_type || 'Common Gap'} {gapDirection}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Estado actual del gap */}
        <div className={`flex items-center gap-3 rounded-lg p-3 border ${status.bg}`}>
          <StatusIcon className={`w-5 h-5 ${status.color} shrink-0`} />
          <div className="flex-1">
            <p className={`text-sm font-bold ${status.color}`}>{status.label}</p>
            {data.fill_percent_current !== undefined && !isFilled && (
              <p className="text-xs text-muted-foreground">Llenado actual: {data.fill_percent_current?.toFixed(1)}%</p>
            )}
          </div>
          <div className="text-right space-y-1">
            {data.current_price && (
              <div>
                <p className="text-[10px] text-muted-foreground">Precio actual</p>
                <p className="text-sm font-bold font-mono text-foreground">${data.current_price?.toFixed(2)}</p>
              </div>
            )}
            {(data.today_high || data.today_low) && (
              <div className="flex flex-col gap-1 text-[10px] font-mono items-end">
                <span className="text-emerald-400">Máx día: ${data.today_high?.toFixed(2)}</span>
                <span className="text-red-400">Mín día: ${data.today_low?.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Gap Precio Visual */}
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4 space-y-3">
          <div className="flex items-stretch gap-3">
            {/* Cierre ayer */}
            <div className="flex-1 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">📅 Cierre Ayer</p>
              <p className="text-2xl font-bold font-mono text-amber-400">${data.previous_close?.toFixed(2) || '---'}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {gapDirection === 'DOWN' ? '← Nivel a llenar (gap DOWN)' : '← Nivel a llenar (gap UP)'}
              </p>
            </div>

            {/* Flecha + Gap */}
            <div className="flex flex-col items-center justify-center gap-1 px-2">
              <div className={`text-lg font-bold ${gapDirection === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>
                {gapDirection === 'UP' ? '↑' : '↓'}
              </div>
              <div className={`text-[10px] font-bold text-center ${gapDirection === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>
                GAP<br/>{gapDirection}
              </div>
              <div className={`text-[11px] font-mono font-bold ${gapDirection === 'UP' ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.gap_size_usd > 0 ? '+' : ''}{data.gap_size_usd?.toFixed(2) || '---'}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                ({data.gap_size_percent > 0 ? '+' : ''}{data.gap_size_percent?.toFixed(2) || '---'}%)
              </div>
            </div>

            {/* Apertura hoy */}
            <div className="flex-1 bg-primary/10 border border-primary/30 rounded-lg p-3 text-center">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">🔔 Apertura Hoy</p>
              <p className="text-2xl font-bold font-mono text-primary">${data.today_open?.toFixed(2) || '---'}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {gapDirection === 'DOWN' ? 'Abrió por debajo del cierre ↓' : 'Abrió por encima del cierre ↑'}
              </p>
            </div>
          </div>
        </div>

        {/* Fill Probability Scale */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Database className="w-3 h-3 text-primary" />
              Probabilidad de Llenado
              <span className="text-[10px] font-normal text-muted-foreground">(estadística histórica)</span>
            </h4>
            {data.sample_count && (
              <span className="text-[10px] text-muted-foreground bg-secondary/60 px-2 py-0.5 rounded-full">
                n={data.sample_count?.toLocaleString()} sesiones
              </span>
            )}
          </div>
          <div className="space-y-2">
            {gapScale.map((s) => {
              const realProb = isFilled ? 100 : (data[s.key] ?? s.fallback);
              return (
                <div key={s.pct} className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground w-12 shrink-0">{s.pct}</span>
                  <div className="flex-1 h-5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                      style={{ width: `${realProb}%` }}
                    >
                      <span className="text-[9px] font-bold text-white">{realProb}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            Basado en datos estadísticos históricos (Bulkowski, Crabel) ajustados al comportamiento de este ticker.
          </p>
        </div>

        {/* ═══ MULTIFACTOR GAP BREAKDOWN ═══ */}
        {(data.gap_small_fill100 != null || data.gap_low_vix_fill100 != null || data.gap_up_fill100 != null) && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-primary" />
              Análisis Multifactor del Gap
              <span className="text-[10px] font-normal text-muted-foreground">(datos empíricos — 1 año)</span>
            </h4>

            {/* By size */}
            {[
              { label: 'Pequeño (<0.5%)', val: data.gap_small_fill100 },
              { label: 'Moderado (0.5-1%)', val: data.gap_moderate_fill100 },
              { label: 'Medio (1-2%)', val: data.gap_medium_fill100 },
              { label: 'Grande (2-5%)', val: data.gap_large_fill100 },
              { label: 'Extremo (>5%)', val: data.gap_extreme_fill100 },
            ].some(s => s.val != null) && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                  <BarChart2 className="w-2.5 h-2.5 text-amber-400" />
                  Fill 100% por tamaño del gap
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { label: '<0.5%', val: data.gap_small_fill100 },
                    { label: '0.5-1%', val: data.gap_moderate_fill100 },
                    { label: '1-2%', val: data.gap_medium_fill100 },
                    { label: '2-5%', val: data.gap_large_fill100 },
                    { label: '>5%', val: data.gap_extreme_fill100 },
                  ].map(s => (
                    <div key={s.label} className="bg-secondary/40 rounded-lg p-1.5 text-center border border-border/40">
                      <p className="text-[8px] text-muted-foreground">{s.label}</p>
                      <p className={`text-sm font-bold font-mono ${s.val != null && s.val >= 60 ? 'text-emerald-400' : s.val != null && s.val >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                        {s.val != null ? `${s.val}%` : '–'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By direction */}
            {(data.gap_up_fill100 != null || data.gap_down_fill100 != null) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 space-y-1">
                  <p className="text-[9px] font-bold text-emerald-400 flex items-center gap-1">
                    <ArrowUpRight className="w-2.5 h-2.5" /> Gap UP
                  </p>
                  <div className="text-[10px] font-mono space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">Fill 50%</span><span className="text-foreground font-semibold">{data.gap_up_fill50 != null ? `${data.gap_up_fill50}%` : '–'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Fill 100%</span><span className="text-foreground font-semibold">{data.gap_up_fill100 != null ? `${data.gap_up_fill100}%` : '–'}</span></div>
                  </div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2 space-y-1">
                  <p className="text-[9px] font-bold text-red-400 flex items-center gap-1">
                    <ArrowDownRight className="w-2.5 h-2.5" /> Gap DOWN
                  </p>
                  <div className="text-[10px] font-mono space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">Fill 50%</span><span className="text-foreground font-semibold">{data.gap_down_fill50 != null ? `${data.gap_down_fill50}%` : '–'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Fill 100%</span><span className="text-foreground font-semibold">{data.gap_down_fill100 != null ? `${data.gap_down_fill100}%` : '–'}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* By context factors */}
            {[
              data.gap_low_vix_fill100 != null && { icon: <Wind className="w-2.5 h-2.5 text-cyan-400" />, label: 'VIX bajo (≤15)', value: `${data.gap_low_vix_fill100}%`, color: 'text-cyan-400' },
              data.gap_high_vix_fill100 != null && { icon: <Wind className="w-2.5 h-2.5 text-red-400" />, label: 'VIX alto (>25)', value: `${data.gap_high_vix_fill100}%`, color: 'text-red-400' },
              data.gap_high_vol_fill100 != null && { icon: <BarChart2 className="w-2.5 h-2.5 text-amber-400" />, label: 'Volumen alto (>1.5x)', value: `${data.gap_high_vol_fill100}%`, color: 'text-amber-400' },
              data.gap_trend_aligned_fill100 != null && { icon: <GitMerge className="w-2.5 h-2.5 text-emerald-400" />, label: 'SPY alineado con fill', value: `${data.gap_trend_aligned_fill100}%`, color: 'text-emerald-400' },
              data.gap_trend_opposed_fill100 != null && { icon: <GitMerge className="w-2.5 h-2.5 text-red-400" />, label: 'SPY opuesto al fill', value: `${data.gap_trend_opposed_fill100}%`, color: 'text-red-400' },
            ].filter(Boolean).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Factores contextuales (fill 100%)</p>
                <div className="space-y-1">
                  {[
                    data.gap_low_vix_fill100 != null && { icon: <Wind className="w-2.5 h-2.5 text-cyan-400" />, label: 'VIX bajo (≤15)', value: `${data.gap_low_vix_fill100}%`, color: 'text-cyan-400' },
                    data.gap_high_vix_fill100 != null && { icon: <Wind className="w-2.5 h-2.5 text-red-400" />, label: 'VIX alto (>25)', value: `${data.gap_high_vix_fill100}%`, color: 'text-red-400' },
                    data.gap_high_vol_fill100 != null && { icon: <BarChart2 className="w-2.5 h-2.5 text-amber-400" />, label: 'Volumen alto (>1.5x avg)', value: `${data.gap_high_vol_fill100}%`, color: 'text-amber-400' },
                    data.gap_trend_aligned_fill100 != null && { icon: <GitMerge className="w-2.5 h-2.5 text-emerald-400" />, label: 'Mercado (SPY) alineado con fill', value: `${data.gap_trend_aligned_fill100}%`, color: 'text-emerald-400' },
                    data.gap_trend_opposed_fill100 != null && { icon: <GitMerge className="w-2.5 h-2.5 text-red-400" />, label: 'Mercado (SPY) opuesto al fill', value: `${data.gap_trend_opposed_fill100}%`, color: 'text-red-400' },
                  ].filter(Boolean).map((item, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary/30 rounded-lg px-2.5 py-1 border border-border/40">
                      <div className="flex items-center gap-1.5">
                        {item.icon}
                        <span className="text-[10px] text-muted-foreground">{item.label}</span>
                      </div>
                      <span className={`text-[10px] font-bold font-mono ${item.color}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* First Candle Methodology Panel */}
        {(data.first_candle_1m || data.first_candle_5m || data.first_candle_15m) && !isFilled && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              Primera Vela — Metodología Multi-Timeframe
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '15min', sublabel: 'Contexto del gap', candle: data.first_candle_15m, color: 'text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/5' },
                { label: '5min',  sublabel: 'Confirmación',     candle: data.first_candle_5m,  color: 'text-cyan-400',  border: 'border-cyan-500/20',  bg: 'bg-cyan-500/5' },
                { label: '1min',  sublabel: 'Entrada precisa',  candle: data.first_candle_1m,  color: 'text-primary',   border: 'border-primary/20',   bg: 'bg-primary/5' },
              ].map(({ label, sublabel, candle, color, border, bg }) => candle && (
                <div key={label} className={`rounded-lg border ${border} ${bg} p-2 space-y-1`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-[10px] font-bold ${color}`}>{label}</p>
                    <span className={`text-[8px] px-1 rounded ${candle.bullish ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                      {candle.bullish ? '▲ ALCISTA' : '▼ BAJISTA'}
                    </span>
                  </div>
                  <p className="text-[8px] text-muted-foreground">{sublabel}</p>
                  <div className="space-y-0.5 text-[9px] font-mono">
                    <div className="flex justify-between"><span className="text-emerald-400">H</span><span className="text-foreground font-bold">${candle.high?.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-red-400">L</span><span className="text-foreground font-bold">${candle.low?.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Rng</span><span className="text-foreground">${candle.range?.toFixed(2)}</span></div>
                  </div>
                  {candle.vol_confirms != null && (
                    <div className={`text-[8px] flex items-center gap-1 ${candle.vol_confirms ? 'text-emerald-400' : 'text-red-400'}`}>
                      <BarChart2 className="w-2 h-2" />
                      {candle.vol_confirms ? 'Vol. confirma ✓' : 'Vol. bajo ✗'}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className={`text-[10px] rounded-lg px-3 py-2 border ${gapDirection === 'UP' ? 'bg-red-500/5 border-red-500/20 text-red-300' : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300'}`}>
              {gapDirection === 'UP'
                ? <span><TrendingDown className="inline w-3 h-3 mr-1 text-red-400" />Entrada PUT: rompe bajo Low 1min <strong className="text-red-400">${data.first_candle_1m?.low?.toFixed(2)}</strong> con volumen → liquidity sweep hacia prev_close</span>
                : <span><TrendingUp className="inline w-3 h-3 mr-1 text-emerald-400" />Entrada CALL: rompe sobre High 1min <strong className="text-emerald-400">${data.first_candle_1m?.high?.toFixed(2)}</strong> con volumen → liquidity sweep hacia prev_close</span>
              }
            </div>
          </div>
        )}

        {/* Trade Levels — solo si el gap no está llenado */}
        {!isFilled && (
          <div className="space-y-3">
            {/* Gap UP: fill trade = PUT (baja a prev_close) | continuation = CALL */}
            {/* Gap DOWN: fill trade = CALL (sube a prev_close) | continuation = PUT */}
            {gapDirection === 'UP' ? (
              <>
                <h4 className="text-xs font-semibold text-red-400">
                  PUT — Gap Fill ↓ (TP = cierre de ayer ${data.previous_close?.toFixed(2)})
                </h4>
                <TradeLevels entry={data.gap_entry_put} stopLoss={data.gap_sl_put} takeProfit={data.gap_tp_put} direction="PUT" />
                <h4 className="text-xs font-semibold text-emerald-400">
                  CALL — Continuación ↑ (gap no se llena)
                </h4>
                <TradeLevels entry={data.gap_entry_call} stopLoss={data.gap_sl_call} takeProfit={data.gap_tp_call} direction="CALL" />
              </>
            ) : (
              <>
                <h4 className="text-xs font-semibold text-emerald-400">
                  CALL — Gap Fill ↑ (TP = cierre de ayer ${data.previous_close?.toFixed(2)})
                </h4>
                <TradeLevels entry={data.gap_entry_call} stopLoss={data.gap_sl_call} takeProfit={data.gap_tp_call} direction="CALL" />
                <h4 className="text-xs font-semibold text-red-400">
                  PUT — Continuación ↓ (gap no se llena)
                </h4>
                <TradeLevels entry={data.gap_entry_put} stopLoss={data.gap_sl_put} takeProfit={data.gap_tp_put} direction="PUT" />
              </>
            )}
          </div>
        )}

        {isFilled && (
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 text-xs text-emerald-400 text-center font-medium">
            ✅ Gap completamente llenado — buscar nuevas oportunidades post-gap
          </div>
        )}

      </CardContent>
    </Card>
  );
}