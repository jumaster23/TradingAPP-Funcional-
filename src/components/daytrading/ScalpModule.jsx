import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, AlertTriangle, Zap, BarChart2, Layers, GitMerge, Wind, Sunrise } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';
import InfoModal from '../trading/InfoModal';
import BollingerBandsPanel from '../trading/BollingerBandsPanel';

const trendIcon = (dir) => {
  if (dir === 'BULLISH') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (dir === 'BEARISH') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-amber-400" />;
};
const trendColor = (dir) => dir === 'BULLISH' ? 'text-emerald-400' : dir === 'BEARISH' ? 'text-red-400' : 'text-amber-400';
const boolBadge = (val, trueLabel, falseLabel) => val
  ? <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" />{trueLabel}</span>
  : <span className="flex items-center gap-1 text-red-400"><XCircle className="w-3 h-3" />{falseLabel}</span>;
const riskColor = (r) => r === 'LOW' ? 'text-emerald-400' : r === 'HIGH' ? 'text-red-400' : 'text-amber-400';
const factorTone = (factor) => {
  const txt = String(factor || '').toLowerCase();
  if (/(contra|riesgo|extremo|freno|peligro|alto|warning|invalida|precauci|bajo)/.test(txt)) {
    return { cls: 'text-red-400', mark: '-' };
  }
  if (/(alinead|favorable|confirma|aceleraci|confluencia|bounce|sobre pp|bajo pp|soporte|resistencia)/.test(txt)) {
    return { cls: 'text-emerald-400', mark: '+' };
  }
  return { cls: 'text-muted-foreground', mark: '•' };
};
const orbQualityMeta = (quality) => {
  if (quality === 'CLEAN') return { label: 'ORB limpio', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
  if (quality === 'MIXED') return { label: 'ORB mixto', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
  if (quality === 'REJECTION') return { label: 'ORB con rechazo', cls: 'bg-red-500/20 text-red-300 border-red-500/30' };
  return null;
};
const orbQualityTone = (quality) => {
  if (quality === 'REJECTION') return 'rejection';
  if (quality === 'MIXED') return 'mixed';
  return 'success';
};
const orbQualityNote = (quality, consolidating) => {
  if (consolidating) return 'Probabilidad recortada por double breakout con rechazo y riesgo de consolidacion.';
  if (quality === 'CLEAN') return 'Probabilidad impulsada por ORB limpio con cierre, cuerpo y volumen.';
  if (quality === 'MIXED') return 'Probabilidad moderada: el ORB confirma de forma parcial.';
  if (quality === 'REJECTION') return 'Probabilidad recortada por rechazo del breakout.';
  return null;
};

export default function ScalpModule({ data, risk }) {
  const [showInfo, setShowInfo] = useState(false);

  if (!data) return (
    <Card className="bg-card border-border/50">
      <CardHeader><CardTitle className="text-sm">🔥 Scalp — 1m / 2m / 3m / 5m / 15m</CardTitle></CardHeader>
      <CardContent className="text-xs text-muted-foreground">Analiza un ticker para ver datos</CardContent>
    </Card>
  );

  const infoContent = `## Scalp Trading — Metodología de 5 Timeframes

### Estructura de Análisis (Top-Down)
1. **15min → Dirección macro: tendencia principal**
2. **5min → Confirmación de señal y estructura**
3. **3min → Zona de entrada potencial identificada**
4. **2min → Confirmación del patrón de vela**
5. **1min → Afinación precisa: trigger de entrada exacto**

### Cómo usar 1min / 2min / 3min para afinar la entrada
- **3min**: Identifica el patrón (engulfing, pin bar, inside bar) en el nivel clave
- **2min**: Confirma que la vela de 2min cierra a favor del trade (cierre alcista/bajista con cuerpo definido)
- **1min**: Espera la ruptura del máximo/mínimo de la vela de 2min para el trigger exacto de entrada

### EMAs Utilizadas
- **EMA 9 > EMA 20** → Fuerza alcista confirmada
- **Precio > EMA 20** → Tendencia sana
- **Rebote EMA 50** → Entrada institucional de alta probabilidad

### Confirmación de Volumen
Solo entrar cuando el volumen en el nivel clave está por encima del promedio. Evitar entradas en bajo volumen.

---
**Resumen:** ${data.summary || '--'}
**Detalle:** ${data.detail || '--'}`;

  return (
    <>
      <Card className="bg-card border-border/50 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-500/60 to-transparent" />
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">🔥 Scalp — 1m / 2m / 3m / 5m / 15m</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20" onClick={() => setShowInfo(true)}>
            <Info className="w-3.5 h-3.5 text-primary" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* 5-Timeframe Structure: Dirección + Confirmación */}
          <div>
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <BarChart2 className="w-3 h-3 text-primary" />Estructura de Dirección
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {[
                { tf: '15min', label: 'Dirección macro', value: data.tf_15min_trend, desc: 'Manda' },
                { tf: '5min', label: 'Confirmación', value: data.tf_5min_confirm, desc: 'Señal' },
              ].map(({ tf, label, value, desc }) => (
                <div key={tf} className="bg-secondary/50 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{tf}</p>
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    {trendIcon(value)}
                    <span className={`text-[10px] font-bold ${trendColor(value)}`}>{value || '--'}</span>
                  </div>
                  <p className="text-[9px] text-muted-foreground/60 mt-0.5">{desc}</p>
                </div>
              ))}
            </div>

            {/* Entry Precision: 3min / 2min / 1min */}
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
              <p className="text-[9px] font-semibold text-amber-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                🎯 Afinación de Entrada (precisión)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { tf: '3min', label: 'Patrón', value: data.tf_3min_pattern, desc: 'Identifica zona' },
                  { tf: '2min', label: 'Confirmación', value: data.tf_2min_confirm, desc: 'Cierre de vela' },
                  { tf: '1min', label: 'Trigger', value: data.signal, desc: 'Entrada exacta' },
                ].map(({ tf, label, value, desc }) => (
                  <div key={tf} className="bg-secondary/60 rounded-lg p-2 text-center border border-amber-500/20">
                    <p className="text-[9px] text-amber-400/80 uppercase tracking-wide font-semibold">{tf}</p>
                    <p className="text-[9px] text-muted-foreground">{label}</p>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {trendIcon(value)}
                      <span className={`text-[10px] font-bold ${trendColor(value)}`}>{value || '--'}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
              {data.entry_precision_note && (
                <p className="text-[9px] text-amber-400/80 mt-2 pt-2 border-t border-amber-500/15">{data.entry_precision_note}</p>
              )}
            </div>
          </div>

          {/* EMA Status */}
          <div className="rounded-lg bg-secondary/30 border border-border/40 p-3 space-y-2">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <BarChart2 className="w-3 h-3 text-primary" />EMAs — Gráfico <span className="text-primary">1min</span>
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'EMA 9 (1m)', val: data.ema9 },
                { label: 'EMA 20 (1m)', val: data.ema20 },
                { label: 'EMA 50 (1m)', val: data.ema50 },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                  <p className="text-[11px] font-bold font-mono text-foreground">{val ? `$${val.toFixed(2)}` : '--'}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1 pt-1 border-t border-border/30">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">EMA 9 {'>'} EMA 20 (fuerza alcista)</span>
                {boolBadge(data.ema9_above_20, 'Sí ✓', 'No ✗')}
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Precio {'>'} EMA 20 (tendencia sana)</span>
                {boolBadge(data.price_above_ema20, 'Sí ✓', 'No ✗')}
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">Rebote EMA 50 (entrada institucional)</span>
                {boolBadge(data.ema50_bounce, 'Detectado', 'No')}
              </div>
            </div>
          </div>

          {/* Volume & Fake Breakout */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40 space-y-1">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-amber-400" />Volumen
              </p>
              <div className="text-[10px]">{boolBadge(data.volume_confirms, 'Confirma entrada', 'Sin confirmar')}</div>
              {data.key_level_type && (
                <p className="text-[9px] text-muted-foreground">Nivel: <span className="text-foreground font-mono">{data.key_level_type}{data.key_level_price ? ` $${data.key_level_price.toFixed(2)}` : ''}</span></p>
              )}
            </div>
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40 space-y-1">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Riesgo Fake BO</p>
              <p className={`text-[11px] font-bold ${riskColor(data.fake_breakout_risk)}`}>{data.fake_breakout_risk || '--'}</p>
              {data.fake_breakout_risk === 'HIGH' && (
                <p className="text-[9px] text-amber-400 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" />Esperar volumen</p>
              )}
            </div>
          </div>

          {/* ORB Strategy Status */}
          {(data.orb_strategy_valid != null || data.orb_break_type || data.orb_strategy_reason) && (
            <div className="rounded-lg bg-secondary/30 border border-border/40 p-2.5 space-y-2">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">ORB Setup</p>
              <div className="flex flex-wrap gap-2">
                {data.orb_strategy_valid != null && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${data.orb_strategy_valid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {data.orb_strategy_valid ? 'ORB válido' : 'ORB invalidado'}
                  </span>
                )}
                {data.orb_break_type && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {data.orb_break_type === 'single' ? 'Single break' : data.orb_break_type === 'double' ? 'Double break' : data.orb_break_type}
                  </span>
                )}
                {orbQualityMeta(data.orb_15m_quality) && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${orbQualityMeta(data.orb_15m_quality).cls}`}>
                    {orbQualityMeta(data.orb_15m_quality).label}
                  </span>
                )}
                {data.orb_15m_likely_consolidation && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-200">
                    Probable consolidacion
                  </span>
                )}
                {(data.spx_direction || data.nq_direction || data.nasdaq100_direction) && (() => {
                  const tradeDir = data.signal === 'CALL' ? 'BULLISH' : data.signal === 'PUT' ? 'BEARISH' : null;
                  const aligned = tradeDir
                    ? [data.spx_direction, data.nq_direction, data.nasdaq100_direction].filter((d) => d === tradeDir).length
                    : 0;
                  return (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${aligned >= 3 ? 'bg-emerald-500/20 text-emerald-400' : aligned === 2 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                      Índices {aligned}/3
                    </span>
                  );
                })()}
              </div>
              {data.orb_strategy_reason && (
                <p className="text-[10px] text-muted-foreground border-t border-border/30 pt-2">{data.orb_strategy_reason}</p>
              )}
            </div>
          )}

          {/* Gamma / OI */}
          {(data.call_wall || data.put_wall || data.gamma_level) && (
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <Layers className="w-2.5 h-2.5 text-cyan-400" />Gamma / OI
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {data.call_wall && (
                  <div>
                    <p className="text-[9px] text-muted-foreground">Call Wall</p>
                    <p className="text-[11px] font-bold font-mono text-emerald-400">${data.call_wall?.toFixed(2)}</p>
                  </div>
                )}
                {data.gamma_level && (
                  <div>
                    <p className="text-[9px] text-muted-foreground">Gamma</p>
                    <p className="text-[11px] font-bold font-mono text-cyan-400">${data.gamma_level?.toFixed(2)}</p>
                  </div>
                )}
                {data.put_wall && (
                  <div>
                    <p className="text-[9px] text-muted-foreground">Put Wall</p>
                    <p className="text-[11px] font-bold font-mono text-red-400">${data.put_wall?.toFixed(2)}</p>
                  </div>
                )}
              </div>
              {data.gamma_context && (
                <p className="text-[9px] text-muted-foreground mt-1.5 border-t border-border/30 pt-1.5">{data.gamma_context}</p>
              )}
            </div>
          )}

          {/* Index Confluence */}
          {(data.spx_direction || data.nq_direction || data.nasdaq100_direction) && (
            <div className="rounded-lg bg-secondary/30 border border-border/40 p-2.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <GitMerge className="w-2.5 h-2.5 text-purple-400" />Confluencia Índices
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'SPX-500', val: data.spx_direction },
                  { label: 'NQ1', val: data.nq_direction },
                  { label: 'NDX100', val: data.nasdaq100_direction },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <p className="text-[9px] text-muted-foreground">{label}</p>
                    <div className="flex items-center justify-center gap-0.5 mt-0.5">
                      {trendIcon(val)}
                      <span className={`text-[9px] font-bold ${trendColor(val)}`}>{val || '--'}</span>
                    </div>
                  </div>
                ))}
              </div>
              {data.index_confluence_summary && (
                <p className="text-[9px] text-muted-foreground mt-1.5 border-t border-border/30 pt-1.5">{data.index_confluence_summary}</p>
              )}
            </div>
          )}

          {/* VIX */}
          {(data.vix_value || data.vix_regime) && (
            <div className="flex items-center gap-3 bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">VIX</p>
                <div className="flex items-center gap-2">
                  {data.vix_value && <span className="text-sm font-bold font-mono text-foreground">{data.vix_value?.toFixed(1)}</span>}
                  <span className={`text-[10px] font-bold ${riskColor(data.vix_regime === 'LOW' ? 'LOW' : data.vix_regime === 'HIGH' || data.vix_regime === 'EXTREME' ? 'HIGH' : 'MEDIUM')}`}>{data.vix_regime}</span>
                </div>
              </div>
              {data.vix_context && <p className="text-[9px] text-muted-foreground max-w-[140px] text-right">{data.vix_context}</p>}
            </div>
          )}

          {/* Premarket */}
          {data.premarket_direction && (data.premarket_high || data.premarket_low) && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5">
              <p className="text-[9px] font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <Sunrise className="w-2.5 h-2.5" />Premarket
                <span className={`ml-auto text-[9px] font-bold ${trendColor(data.premarket_direction)}`}>{data.premarket_direction}</span>
              </p>
              <div className="grid grid-cols-2 gap-2 text-center text-[9px] font-mono mb-1.5">
                {data.premarket_high && <div><span className="text-muted-foreground">H: </span><span className="text-emerald-400 font-bold">${data.premarket_high?.toFixed(2)}</span></div>}
                {data.premarket_low && <div><span className="text-muted-foreground">L: </span><span className="text-red-400 font-bold">${data.premarket_low?.toFixed(2)}</span></div>}
              </div>
              {data.premarket_note && <p className="text-[9px] text-muted-foreground border-t border-amber-500/10 pt-1.5">{data.premarket_note}</p>}
            </div>
          )}

          {/* Bollinger Bands */}
          {(data.bb_1m || data.bb_5m) && (
            <div className="space-y-2">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">📉 Bandas de Bollinger</p>
              {data.bb_1m && <BollingerBandsPanel bb={data.bb_1m} label="1 min" />}
              {data.bb_5m && <BollingerBandsPanel bb={data.bb_5m} label="5 min" />}
            </div>
          )}

          {/* Signal summary */}
          <div className="flex items-center gap-3">
            <SignalBadge signal={data.signal} />
            <span className="text-xs text-muted-foreground flex-1">{data.summary}</span>
            {data.setup_grade && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${data.setup_grade === 'A+' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : data.setup_grade === 'B+' ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' : data.setup_grade === 'B' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                Setup {data.setup_grade}
              </span>
            )}
          </div>

          {(data.entry_alert || data.no_trade_recommended) && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5">
              <p className="text-[10px] text-amber-300 font-semibold">Alerta de entrada</p>
              <p className="text-[10px] text-amber-200 mt-0.5">{data.entry_alert || data.no_trade_reason || 'Contexto no ideal para ejecutar agresivo; esperar confirmación adicional.'}</p>
              {data.execution_tier && (
                <p className="text-[9px] text-amber-200/90 mt-1">
                  Tamaño sugerido: {data.execution_tier === 'large' ? 'grande (80-100%)' : data.execution_tier === 'normal' ? 'normal (50-70%)' : 'bajo (25-40%)'}.
                </p>
              )}
              {data.max_trades_per_session && (
                <p className="text-[9px] text-amber-200/90 mt-1">Disciplina: máximo {data.max_trades_per_session} trades por sesión.</p>
              )}
            </div>
          )}

          <TradeLevels entry={data.entry} stopLoss={data.sl} takeProfit={data.tp} direction={data.signal} />
          <ProbabilityBar
            label="Probabilidad de Éxito"
            successPercent={data.success_prob || 50}
            tone="success"
            note={orbQualityNote(data.orb_15m_quality, data.orb_15m_likely_consolidation)}
          />

          {/* Confluencias usadas para score */}
          {(data.confluence_score != null || Array.isArray(data.confluence_factors)) && (
            <div className="rounded-lg bg-secondary/30 border border-border/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Confluencias usadas</p>
                {data.confluence_score != null && (
                  <span className="text-[10px] font-bold font-mono text-primary">Score: {data.confluence_score}</span>
                )}
              </div>
              {Array.isArray(data.confluence_factors) && data.confluence_factors.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {data.confluence_factors.slice(0, 10).map((f, idx) => {
                    const tone = factorTone(f);
                    return (
                      <div key={idx} className={`text-[10px] ${tone.cls}`}>
                        {tone.mark} {f}
                      </div>
                    );
                  })}
                </div>
              )}
              {(data.confluence_warning || data.rr_warning) && (
                <div className="space-y-1 pt-1 border-t border-border/30">
                  {data.confluence_warning && <p className="text-[10px] text-amber-400">{data.confluence_warning}</p>}
                  {data.rr_warning && <p className="text-[10px] text-red-400">{data.rr_warning}</p>}
                </div>
              )}
            </div>
          )}

          {risk && (
            <div className="pt-3 border-t border-border/40 space-y-2">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">⚖️ Gestión de Riesgo</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-muted-foreground">Riesgo Máx.</p>
                  <p className="text-sm font-bold text-amber-400">{risk.max_risk_pct}%</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-muted-foreground">R:R Ratio</p>
                  <p className="text-sm font-bold text-primary">{risk.rr_ratio}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 text-center">
                  <p className="text-[9px] text-muted-foreground">Posición</p>
                  <p className="text-[10px] font-semibold text-foreground leading-tight">{risk.position_suggestion}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <InfoModal open={showInfo} onClose={() => setShowInfo(false)} title="Scalp — Metodología" content={infoContent} />
    </>
  );
}