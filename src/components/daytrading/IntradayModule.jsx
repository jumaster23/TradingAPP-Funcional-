import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Info, TrendingUp, TrendingDown, Minus, Activity, Layers, Wind, GitMerge } from 'lucide-react';
import SignalBadge from '../trading/SignalBadge';
import TradeLevels from '../trading/TradeLevels';
import ProbabilityBar from '../trading/ProbabilityBar';
import InfoModal from '../trading/InfoModal';
import BollingerBandsPanel from '../trading/BollingerBandsPanel';

const dirColor = (d) => d === 'BULLISH' ? 'text-emerald-400' : d === 'BEARISH' ? 'text-red-400' : 'text-amber-400';
const dirIcon = (d) => d === 'BULLISH'
  ? <TrendingUp className="w-3 h-3 text-emerald-400" />
  : d === 'BEARISH'
    ? <TrendingDown className="w-3 h-3 text-red-400" />
    : <Minus className="w-3 h-3 text-amber-400" />;

const vixColor = (v) => {
  if (v === 'LOW') return 'text-emerald-400';
  if (v === 'HIGH') return 'text-amber-400';
  if (v === 'EXTREME') return 'text-red-400';
  return 'text-foreground';
};
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
  if (consolidating) return 'Probabilidad recortada: el ultimo breakout sugiere consolidacion del precio.';
  if (quality === 'CLEAN') return 'Probabilidad reforzada por ORB 30m limpio con cuerpo y volumen.';
  if (quality === 'MIXED') return 'Probabilidad intermedia: el breakout 30m no fue totalmente limpio.';
  if (quality === 'REJECTION') return 'Probabilidad recortada por rechazo del breakout en ORB 30m.';
  return null;
};

export default function IntradayModule({ data, risk }) {
  const [showInfo, setShowInfo] = useState(false);

  if (!data) return (
    <Card className="bg-card border-border/50">
      <CardHeader><CardTitle className="text-sm">📈 Intraday — 5min / 15min / 30min / 1h</CardTitle></CardHeader>
      <CardContent className="text-xs text-muted-foreground">Analiza un ticker para ver datos</CardContent>
    </Card>
  );

  const infoContent = `## Intraday Trading — Metodología de 4 Timeframes

### Estructura de Análisis
1. **1h + 30min → Dirección macro del precio** (estos timeframes MANDAN)
2. **15min → Pullback o confirmación de estructura al soporte**
3. **5min → Ejecución de la entrada**

### Confluencias utilizadas
- **ORB Analysis**: rangos de apertura de 5min, 15min, 30min y 1h
- **Tendencia del mercado**: precio sobre/bajo EMAs en múltiples timeframes
- **Índices**: SPX, NQ1!, Nasdaq100 — si los 3 confirman = alta probabilidad
- **VIX**: régimen de volatilidad — bajo VIX = tendencias limpias, alto VIX = más trampas
- **Gamma & OI**: call wall, put wall, gamma level como objetivos de precio

---
**Resumen:** ${data.summary || '--'}
**Detalle:** ${data.detail || '--'}`;

  return (
    <>
      <Card className="bg-card border-border/50 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/60 to-transparent" />
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">📈 Intraday — 5min / 15min / 30min / 1h</CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20" onClick={() => setShowInfo(true)}>
            <Info className="w-3.5 h-3.5 text-primary" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* 4-Timeframe Structure */}
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { tf: '1h', label: 'Dirección', value: data.tf_1h_direction, note: 'Manda' },
              { tf: '30min', label: 'Dirección', value: data.tf_30min_direction, note: 'Confirma' },
              { tf: '15min', label: 'Estructura', value: data.tf_15min_structure, note: 'Pullback' },
              { tf: '5min', label: 'Señal', value: data.tf_5min_signal, note: 'Ejecuta' },
            ].map(({ tf, label, value, note }) => (
              <div key={tf} className="bg-secondary/50 rounded-lg p-2 text-center border border-border/30">
                <p className="text-[9px] font-bold text-muted-foreground uppercase">{tf}</p>
                <div className="flex items-center justify-center gap-0.5 mt-1">
                  {dirIcon(value)}
                  <span className={`text-[9px] font-bold ${dirColor(value)}`}>{value || '--'}</span>
                </div>
                <p className="text-[8px] text-muted-foreground/60 mt-0.5">{note}</p>
              </div>
            ))}
          </div>

          {/* ORB Context */}
          {data.orb_context && (
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">📊 Contexto ORB</p>
              <p className="text-[10px] text-foreground">{data.orb_context}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {data.orb_30m_status && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    ORB 30m {data.orb_30m_status}
                  </span>
                )}
                {orbQualityMeta(data.orb_30m_quality) && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${orbQualityMeta(data.orb_30m_quality).cls}`}>
                    {orbQualityMeta(data.orb_30m_quality).label}
                  </span>
                )}
                {data.orb_30m_likely_consolidation && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-200">
                    Probable consolidacion
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Index Confluences */}
          <div className="rounded-lg bg-secondary/30 border border-border/40 p-3 space-y-2">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <GitMerge className="w-3 h-3 text-purple-400" />Confluencia de Índices
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'SPX', value: data.spx_confirm },
                { label: 'NQ1!', value: data.nq_confirm },
                { label: 'NASDAQ', value: data.nasdaq_confirm },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                  <div className="flex items-center justify-center gap-0.5 mt-0.5">
                    {dirIcon(value)}
                    <span className={`text-[9px] font-bold ${dirColor(value)}`}>{value || '--'}</span>
                  </div>
                </div>
              ))}
            </div>
            {data.index_confluence && (
              <p className="text-[10px] text-muted-foreground border-t border-border/30 pt-1.5">{data.index_confluence}</p>
            )}
          </div>

          {/* VIX + Gamma row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1">
                <Wind className="w-2.5 h-2.5 text-cyan-400" />VIX
              </p>
              {data.vix_value && <p className="text-lg font-bold font-mono text-foreground">{data.vix_value?.toFixed(1)}</p>}
              <p className={`text-[10px] font-bold ${vixColor(data.vix_regime)}`}>{data.vix_regime || '--'}</p>
              {data.vix_context && <p className="text-[9px] text-muted-foreground mt-0.5">{data.vix_context}</p>}
            </div>
            <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/40">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide flex items-center gap-1 mb-1">
                <Layers className="w-2.5 h-2.5 text-cyan-400" />Gamma / OI
              </p>
              <div className="space-y-0.5 text-[10px] font-mono">
                {data.call_wall && <p className="text-emerald-400">Call Wall: ${data.call_wall?.toFixed(2)}</p>}
                {data.gamma_level && <p className="text-cyan-400">Gamma: ${data.gamma_level?.toFixed(2)}</p>}
                {data.put_wall && <p className="text-red-400">Put Wall: ${data.put_wall?.toFixed(2)}</p>}
                {data.gamma_source && <p className="text-[9px] text-muted-foreground">Fuente: {String(data.gamma_source).toUpperCase()}</p>}
                {data.gamma_calculation_mode && <p className="text-[9px] text-muted-foreground">Cálculo: {data.gamma_calculation_mode === 'near_open' ? 'Cerca apertura' : 'Institucional amplio'}</p>}
                {data.strict_real_gamma != null && (
                  <p className="text-[9px] text-muted-foreground">Solo gamma real: {data.strict_real_gamma ? 'ON' : 'OFF'}</p>
                )}
                {data.gamma_expiration_mode && <p className="text-[9px] text-muted-foreground">Modo: {data.gamma_expiration_mode}</p>}
                {data.gamma_options_expiration && <p className="text-[9px] text-muted-foreground">Exp: {String(data.gamma_options_expiration)}</p>}
                {data.gamma_level_near_open != null && data.gamma_level_institutional != null && (
                  <p className="text-[9px] text-muted-foreground">
                    Near open: ${Number(data.gamma_level_near_open).toFixed(2)} | Inst: ${Number(data.gamma_level_institutional).toFixed(2)}
                  </p>
                )}
                {data.gamma_flip != null && <p className="text-[9px] text-amber-300">Gamma Flip: ${Number(data.gamma_flip).toFixed(2)}</p>}
                {data.gex_total != null && (
                  <p className={`text-[9px] ${Number(data.gex_total) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    GEX: {Number(data.gex_total).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                )}
                {data.gex_regime && <p className="text-[9px] text-muted-foreground">Regimen GEX: {String(data.gex_regime)}</p>}
                {data.gex_market_mode && <p className="text-[9px] text-muted-foreground">Modo mercado: {String(data.gex_market_mode)}</p>}
                {(data.gex_0dte != null || data.gex_ex_0dte != null) && (
                  <p className="text-[9px] text-muted-foreground">
                    0DTE: {data.gex_0dte != null ? Number(data.gex_0dte).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A'} | ex-0DTE: {data.gex_ex_0dte != null ? Number(data.gex_ex_0dte).toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A'}
                  </p>
                )}
                {(data.gex_direct_gamma_count != null || data.gex_estimated_gamma_count != null) && (
                  <p className="text-[9px] text-muted-foreground">
                    gamma directa: {data.gex_direct_gamma_count ?? 0} | estimada: {data.gex_estimated_gamma_count ?? 0}
                  </p>
                )}
                {data.data_quality === 'LOW' && (
                  <div className="mt-1.5 flex items-start gap-1 rounded bg-yellow-500/15 border border-yellow-400/40 px-2 py-1">
                    <span className="text-yellow-400 text-[10px] font-semibold leading-tight">⚠ Calidad de datos BAJA</span>
                    <span className="text-[9px] text-yellow-300/80 leading-tight">{data.data_quality_reason}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* EMAs 5min */}
          <div className="rounded-lg bg-secondary/30 border border-border/40 p-2.5">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Activity className="w-3 h-3 text-primary" />EMAs (5min)
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'EMA 9', val: data.ema9_5min },
                { label: 'EMA 20', val: data.ema20_5min },
                { label: 'EMA 50', val: data.ema50_5min },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                  <p className="text-[11px] font-bold font-mono text-foreground">{val ? `$${val.toFixed(2)}` : '--'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Bollinger Bands 5min */}
          {data.bb_5m && (
            <BollingerBandsPanel bb={data.bb_5m} label="5 min" />
          )}

          {/* Signal */}
          <div className="flex items-center gap-3">
            <SignalBadge signal={data.signal} />
            <span className="text-xs text-muted-foreground flex-1">{data.summary}</span>
            {data.setup_grade && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${data.setup_grade === 'A+' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : data.setup_grade === 'B+' ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10' : data.setup_grade === 'B' ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                Setup {data.setup_grade}
              </span>
            )}
          </div>

          {(data.entry_alert || data.execution_tier) && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2.5">
              <p className="text-[10px] text-amber-300 font-semibold">Alerta de entrada</p>
              <p className="text-[10px] text-amber-200 mt-0.5">{data.entry_alert || 'La señal es operable, pero no con calidad A+; ajustar el tamaño a las condiciones actuales.'}</p>
              {data.execution_tier && (
                <p className="text-[9px] text-amber-200/90 mt-1">
                  Tamaño sugerido: {data.execution_tier === 'large' ? 'grande (80-100%)' : data.execution_tier === 'normal' ? 'normal (50-70%)' : 'bajo (25-40%)'}.
                </p>
              )}
            </div>
          )}

          <TradeLevels entry={data.entry} stopLoss={data.sl} takeProfit={data.tp} direction={data.signal} />
          <ProbabilityBar
            label="Probabilidad de Éxito"
            successPercent={data.success_prob || 50}
            tone={orbQualityTone(data.orb_30m_quality)}
            note={orbQualityNote(data.orb_30m_quality, data.orb_30m_likely_consolidation)}
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
      <InfoModal open={showInfo} onClose={() => setShowInfo(false)} title="Intraday — Metodología" content={infoContent} />
    </>
  );
}