import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, RefreshCw, Globe, BarChart2, Wind, Shield, MessageSquare, Activity } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const SCHEMA = {
  type: 'object',
  properties: {
    // Componente 1: Tendencia (peso 0.25)
    trend_score: { type: 'number' }, // 0-100
    trend_direction: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
    trend_higher_highs: { type: 'boolean' },
    trend_lower_highs: { type: 'boolean' },
    trend_volume_weak_up: { type: 'boolean' },
    trend_volume_strong_down: { type: 'boolean' },
    trend_note: { type: 'string' },

    // Componente 2: Volumen (peso 0.20)
    volume_score: { type: 'number' },
    volume_profile_note: { type: 'string' },
    vwap_position: { type: 'string', enum: ['ABOVE', 'BELOW', 'AT'] },
    vwap_value: { type: 'number' },
    volume_note: { type: 'string' },

    // Componente 3: VIX (peso 0.20)
    vix_score: { type: 'number' },
    vix_value: { type: 'number' },
    vix_direction: { type: 'string', enum: ['RISING', 'FALLING', 'STABLE'] },
    vix_regime: { type: 'string', enum: ['LOW', 'MODERATE', 'HIGH', 'EXTREME'] },
    rsi_overbought: { type: 'boolean' },
    rsi_value: { type: 'number' },
    vix_note: { type: 'string' },

    // Componente 4: Soporte/Resistencia (peso 0.15)
    sr_score: { type: 'number' },
    price_at_support: { type: 'boolean' },
    price_at_resistance: { type: 'boolean' },
    liquidity_sweep_detected: { type: 'boolean' },
    institutional_level_note: { type: 'string' },
    sr_note: { type: 'string' },

    // Componente 5: Sentimiento (peso 0.20)
    sentiment_score: { type: 'number' },
    put_call_ratio: { type: 'number' },
    put_call_bias: { type: 'string', enum: ['BEARISH', 'NEUTRAL', 'BULLISH'] },
    fed_expectation: { type: 'string' },
    macro_news_sentiment: { type: 'string', enum: ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] },
    govt_type: { type: 'string' },
    macro_conflicts: { type: 'string' },
    refuge_capital_flow: { type: 'string' },
    sentiment_note: { type: 'string' },

    // Resultado final
    prob_up: { type: 'number' },   // 0-100
    prob_down: { type: 'number' }, // 0-100
    market_regime: { type: 'string', enum: ['STRONG_BULL', 'WEAK_BULL', 'NEUTRAL', 'WEAK_BEAR', 'STRONG_BEAR'] },
    summary: { type: 'string' },
    action_note: { type: 'string' },
  }
};

function ScoreBar({ label, score, weight, color, icon: Icon }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className={`w-3 h-3 ${color}`} />
          {label}
          <span className="text-muted-foreground/50">×{weight}</span>
        </span>
        <span className={`font-bold font-mono ${color}`}>{pct.toFixed(0)}/100</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 60 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Check({ val, label }) {
  return (
    <div className={`flex items-center gap-1.5 text-[10px] ${val ? 'text-emerald-400' : 'text-red-400/70'}`}>
      <span>{val ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  );
}

const regimeConfig = {
  STRONG_BULL: { label: 'Alcista Fuerte', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40', text: 'text-emerald-400' },
  WEAK_BULL:   { label: 'Alcista Débil',  bg: 'bg-emerald-500/8',  border: 'border-emerald-500/25', text: 'text-emerald-300' },
  NEUTRAL:     { label: 'Neutral',        bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-400' },
  WEAK_BEAR:   { label: 'Bajista Débil',  bg: 'bg-red-500/8',      border: 'border-red-500/25',     text: 'text-red-300' },
  STRONG_BEAR: { label: 'Bajista Fuerte', bg: 'bg-red-500/15',     border: 'border-red-500/40',     text: 'text-red-400' },
};

export default function MacroScorecard() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const runAnalysis = async () => {
    setIsLoading(true);
    try {
      // Fetch VIX + SPY real price in parallel for maximum freshness
      const [vixResult, spyResult] = await Promise.allSettled([
        base44.functions.invoke('getVix', {}),
        base44.functions.invoke('getStockPrice', { ticker: 'SPY' }),
      ]);
      const vixData = vixResult?.status === 'fulfilled' ? vixResult.value?.data : null;
      const spyData = spyResult?.status === 'fulfilled' ? spyResult.value?.data : null;

      const now = new Date();
      const nowISO = now.toISOString();
      const nowLocal = now.toLocaleString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

      const vixHint = vixData && !vixData.error
        ? `VIX REAL AHORA (${nowLocal}): ${vixData.vix} (cambio: ${vixData.vix_change > 0 ? '+' : ''}${vixData.vix_change?.toFixed(2)}, ${vixData.vix_change_pct?.toFixed(2)}%) — Régimen: ${vixData.regime}`
        : 'Obtén el VIX actual de Yahoo Finance (^VIX).';

      const spyHint = spyData
        ? `⚠️ PRECIO REAL DE SPY — YAHOO FINANCE — OBTENIDO JUSTO AHORA (${nowLocal}):
SPY current_price = $${spyData.current_price}
SPY prev_close = $${spyData.prev_close}
SPY today_open = $${spyData.today_open}
SPY today_high = $${spyData.today_high}
SPY today_low = $${spyData.today_low}
SPY volume = ${spyData.volume?.toLocaleString() || 'N/A'}
Cambio hoy: ${spyData.current_price && spyData.prev_close ? ((spyData.current_price - spyData.prev_close) / spyData.prev_close * 100).toFixed(2) + '%' : 'N/A'}

USA ESTOS PRECIOS REALES para evaluar tendencia, VWAP relativo y niveles S/R.`
        : 'Obtén el precio actual de SPY de Yahoo Finance.';

      const data = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un analista macro institucional de primer nivel. Fecha y hora EXACTA: ${nowISO} (${nowLocal}).

${spyHint}

${vixHint}

Realiza un ANÁLISIS MACRO COMPLETO del mercado de EE.UU. (SPY / S&P 500) para determinar la probabilidad de subida vs bajada. TODOS los datos deben reflejar la situación AL MOMENTO (${nowLocal}).

═══ FÓRMULA DE PUNTUACIÓN (obligatoria) ═══

La probabilidad de SUBIDA se calcula así:
  prob_up = (trend_score × 0.25) + (volume_score × 0.20) + (vix_score × 0.20) + (sr_score × 0.15) + (sentiment_score × 0.20)

Donde cada componente es un número de 0 a 100:
- 100 = fuertemente alcista para ese componente
- 50 = neutral
- 0 = fuertemente bajista para ese componente

La probabilidad de BAJADA es: prob_down = 100 - prob_up

═══ COMPONENTE 1: TENDENCIA (peso 0.25) ═══
Analiza SPY / S&P 500 con el precio REAL provisto ($${spyData?.current_price || '?'}):
- trend_higher_highs: ¿está haciendo máximos y mínimos crecientes? → alcista
- trend_lower_highs: ¿está haciendo máximos decrecientes? → bajista
- trend_volume_weak_up: ¿subida con poco volumen? → señal de debilidad (bajista)
- trend_volume_strong_down: ¿caída con fuerte volumen? → señal de fuerza bajista
- trend_direction: BULLISH / BEARISH / NEUTRAL según estructura actual
- trend_score: 0-100 (75-100=alcista fuerte, 50-75=alcista débil, 40-60=neutral, 25-40=bajista débil, 0-25=bajista fuerte)
- trend_note: 1-2 frases en español

═══ COMPONENTE 2: VOLUMEN (peso 0.20) ═══
Usa el volumen REAL de SPY: ${spyData?.volume?.toLocaleString() || 'buscar en Yahoo Finance'}
- volume_profile_note: qué dice el perfil de volumen (POC, VAH, VAL) del S&P 500 ahora
- vwap_position: ¿el precio del SPY ($${spyData?.current_price || '?'}) está ABOVE / BELOW / AT el VWAP?
- vwap_value: valor numérico del VWAP de hoy del SPY
- volume_score: 0-100 (arriba del VWAP con volumen creciente = 80+, bajo VWAP con volumen en caída = 20-)
- volume_note: 1-2 frases en español

═══ COMPONENTE 3: VIX (peso 0.20) ═══
Usa el dato real del VIX provisto arriba.
- vix_value: valor numérico del VIX
- vix_direction: RISING (sube = miedo) / FALLING (baja = confianza) / STABLE
- vix_regime: LOW (<15) / MODERATE (15-20) / HIGH (20-30) / EXTREME (>30)
- rsi_value: RSI(14) del SPY en diario ahora mismo
- rsi_overbought: ¿RSI > 70? → si VIX sube también → alta probabilidad de caída
- REGLA ESPECIAL: RSI sobrecompra + VIX subiendo + volumen débil = vix_score bajo (20-30)
- vix_score: 0-100 (VIX bajo y bajando = 80+; VIX alto y subiendo = 10-20)
- vix_note: 1-2 frases en español

═══ COMPONENTE 4: SOPORTE Y RESISTENCIA (peso 0.15) ═══
- price_at_support: ¿el SPY está rebotando en nivel de soporte institucional clave?
- price_at_resistance: ¿el SPY está chocando con resistencia clave?
- liquidity_sweep_detected: ¿hubo barrido de liquidez reciente (stop hunt por debajo/encima de nivel clave)?
- institutional_level_note: describe los niveles institucionales clave actuales del S&P 500 (soporte y resistencia en números)
- sr_score: 0-100 (en soporte sólido = 80+; en resistencia = 30-; en zona media = 50)
- sr_note: 1-2 frases en español

═══ COMPONENTE 5: SENTIMIENTO (peso 0.20) ═══
- put_call_ratio: ratio put/call del mercado ahora (>1.2 = miedo/bajista, <0.7 = codicia/alcista)
- put_call_bias: BEARISH (ratio alto) / NEUTRAL / BULLISH (ratio bajo)
- fed_expectation: qué espera el mercado de la Fed en la próxima reunión (subir/bajar/pausar tasas)
- macro_news_sentiment: POSITIVE / NEUTRAL / NEGATIVE — sentiment de noticias macro de esta semana
- govt_type: describe brevemente el tipo de gobierno actual de EE.UU. y su sesgo de política económica (fiscal, aranceles, etc.)
- macro_conflicts: conflictos geopolíticos activos que afectan el mercado (Ucrania, Medio Oriente, Taiwan, aranceles, etc.)
- refuge_capital_flow: ¿está el capital fluyendo hacia activos de refugio? (oro, bonos del Tesoro, yen, CHF) — describe brevemente
- sentiment_score: 0-100 (put/call bajo + Fed dovish + news positivas + sin conflictos = 80+; lo contrario = 15-)
- sentiment_note: 1-2 frases en español

═══ RESULTADO FINAL ═══
Aplica la fórmula exacta:
  prob_up = (trend_score × 0.25) + (volume_score × 0.20) + (vix_score × 0.20) + (sr_score × 0.15) + (sentiment_score × 0.20)
  prob_down = 100 - prob_up

- market_regime: STRONG_BULL (prob_up>75) / WEAK_BULL (60-75) / NEUTRAL (40-60) / WEAK_BEAR (25-40) / STRONG_BEAR (<25)
- summary: párrafo de 3-5 frases en español explicando los factores más importantes que dominan el escenario actual
- action_note: 1-2 frases en español con recomendación de acción (no es consejo financiero, es contexto técnico)

TODOS los textos DEBEN estar en español.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: SCHEMA
      });

      // Override VIX with real backend data
      if (vixData && !vixData.error) {
        data.vix_value = vixData.vix;
        data.vix_direction = vixData.vix_change > 0.5 ? 'RISING' : vixData.vix_change < -0.5 ? 'FALLING' : 'STABLE';
        data.vix_regime = vixData.vix < 15 ? 'LOW' : vixData.vix < 20 ? 'MODERATE' : vixData.vix < 30 ? 'HIGH' : 'EXTREME';
      }

      // Recalculate prob_up with exact formula to ensure correctness
      const recalc = (data.trend_score * 0.25) + (data.volume_score * 0.20) + (data.vix_score * 0.20) + (data.sr_score * 0.15) + (data.sentiment_score * 0.20);
      data.prob_up = Math.round(recalc);
      data.prob_down = 100 - data.prob_up;

      // Attach real SPY price metadata
      data._spy_price = spyData?.current_price ?? null;
      data._spy_change = spyData?.current_price && spyData?.prev_close
        ? Number(((spyData.current_price - spyData.prev_close) / spyData.prev_close * 100).toFixed(2))
        : null;
      data._analysisTime = now.toISOString();

      setResult(data);
      setLastUpdated(now.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      toast.success('Análisis macro completado');
    } catch (err) {
      toast.error('Error en análisis macro: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const regime = result ? regimeConfig[result.market_regime] || regimeConfig.NEUTRAL : null;

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-purple-500/40 to-transparent" />
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            Análisis Macro — Probabilidades de Mercado
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={runAnalysis}
            disabled={isLoading}
            className="h-7 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? 'Analizando...' : 'Analizar Macro'}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!result && !isLoading && (
          <div className="flex flex-col items-center justify-center py-10 space-y-3 text-center">
            <Globe className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Haz clic en "Analizar Macro" para obtener probabilidades de mercado en tiempo real.</p>
            <p className="text-[10px] text-muted-foreground/60">
              Fórmula: Tendencia(25%) + Volumen(20%) + VIX(20%) + S&R(15%) + Sentimiento(20%)
            </p>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Analizando mercado macro...</p>
              <p className="text-[10px] text-muted-foreground/60">VIX · Tendencia · Volumen · S&R · Sentimiento</p>
            </div>
          </div>
        )}

        {result && !isLoading && (
          <div className="space-y-5">

            {/* ── Probability Meter ── */}
            <div className="rounded-xl border border-border/40 bg-secondary/20 overflow-hidden">
              <div className={`flex items-center gap-3 px-4 py-3 ${regime?.bg} border-b ${regime?.border}`}>
                {result.prob_up >= 50
                  ? <TrendingUp className={`w-5 h-5 ${regime?.text}`} />
                  : <TrendingDown className={`w-5 h-5 ${regime?.text}`} />
                }
                <div className="flex-1">
                  <p className={`text-sm font-bold ${regime?.text}`}>Régimen: {regime?.label}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {result._spy_price && (
                      <span className="text-[10px] font-mono text-foreground">
                        SPY: <span className="font-bold">${result._spy_price.toFixed(2)}</span>
                        {result._spy_change != null && (
                          <span className={`ml-1 ${result._spy_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            ({result._spy_change > 0 ? '+' : ''}{result._spy_change}%)
                          </span>
                        )}
                      </span>
                    )}
                    {lastUpdated && <p className="text-[9px] text-muted-foreground">⏱ {lastUpdated}</p>}
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Main probability bar */}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-emerald-400 font-bold w-10 text-right">{result.prob_up}%</span>
                  <div className="flex-1 h-8 rounded-full overflow-hidden bg-secondary flex">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 flex items-center justify-center text-xs font-bold text-white transition-all duration-700"
                      style={{ width: `${result.prob_up}%` }}
                    >
                      {result.prob_up >= 20 && '▲ Subida'}
                    </div>
                    <div
                      className="h-full bg-gradient-to-r from-red-500 to-red-400 flex items-center justify-center text-xs font-bold text-white transition-all duration-700"
                      style={{ width: `${result.prob_down}%` }}
                    >
                      {result.prob_down >= 20 && '▼ Bajada'}
                    </div>
                  </div>
                  <span className="text-[10px] text-red-400 font-bold w-10">{result.prob_down}%</span>
                </div>

                {/* Formula breakdown */}
                <div className="bg-secondary/30 rounded-lg p-2.5 border border-border/30">
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2 font-semibold">Cálculo de Probabilidad</p>
                  <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                    <div className="flex justify-between">
                      <span>Tendencia × 0.25</span>
                      <span className="text-foreground">{(result.trend_score * 0.25).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Volumen × 0.20</span>
                      <span className="text-foreground">{(result.volume_score * 0.20).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>VIX × 0.20</span>
                      <span className="text-foreground">{(result.vix_score * 0.20).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>S&R × 0.15</span>
                      <span className="text-foreground">{(result.sr_score * 0.15).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Sentimiento × 0.20</span>
                      <span className="text-foreground">{(result.sentiment_score * 0.20).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between border-t border-border/40 pt-1 mt-1 font-bold">
                      <span className="text-emerald-400">= P(Subida)</span>
                      <span className="text-emerald-400">{result.prob_up}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Component Scores ── */}
            <div className="space-y-3">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Puntuaciones por Componente</p>
              <ScoreBar label="Tendencia" score={result.trend_score} weight="0.25" color="text-cyan-400" icon={TrendingUp} />
              <ScoreBar label="Volumen / VWAP" score={result.volume_score} weight="0.20" color="text-amber-400" icon={BarChart2} />
              <ScoreBar label="VIX / Volatilidad" score={result.vix_score} weight="0.20" color="text-purple-400" icon={Wind} />
              <ScoreBar label="Soporte & Resistencia" score={result.sr_score} weight="0.15" color="text-emerald-400" icon={Shield} />
              <ScoreBar label="Sentimiento" score={result.sentiment_score} weight="0.20" color="text-orange-400" icon={MessageSquare} />
            </div>

            {/* ── Detail Grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

              {/* Tendencia */}
              <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-2">
                <p className="text-[9px] font-semibold text-cyan-400 uppercase tracking-wide flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />Tendencia
                </p>
                <Check val={result.trend_higher_highs} label="Máximos y mínimos crecientes (alcista)" />
                <Check val={!result.trend_lower_highs} label="Sin máximos decrecientes" />
                <Check val={!result.trend_volume_weak_up} label="Sin subida con volumen débil" />
                <Check val={!result.trend_volume_strong_down} label="Sin caída con volumen fuerte" />
                {result.trend_note && <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/20">{result.trend_note}</p>}
              </div>

              {/* VIX */}
              <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-2">
                <p className="text-[9px] font-semibold text-purple-400 uppercase tracking-wide flex items-center gap-1">
                  <Wind className="w-3 h-3" />VIX / RSI
                </p>
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <p className="text-[9px] text-muted-foreground">VIX</p>
                    <p className={`text-lg font-bold font-mono ${result.vix_direction === 'RISING' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {result.vix_value?.toFixed(1) || '--'}
                    </p>
                    <p className={`text-[9px] font-bold ${result.vix_direction === 'RISING' ? 'text-red-400' : result.vix_direction === 'FALLING' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {result.vix_direction === 'RISING' ? '↑ Miedo' : result.vix_direction === 'FALLING' ? '↓ Confianza' : '→ Estable'}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[9px] text-muted-foreground">RSI(14)</p>
                    <p className={`text-lg font-bold font-mono ${result.rsi_overbought ? 'text-red-400' : 'text-emerald-400'}`}>
                      {result.rsi_value?.toFixed(1) || '--'}
                    </p>
                    <p className={`text-[9px] font-bold ${result.rsi_overbought ? 'text-red-400' : 'text-muted-foreground'}`}>
                      {result.rsi_overbought ? '⚠ Sobrecompra' : 'Normal'}
                    </p>
                  </div>
                </div>
                {result.rsi_overbought && result.vix_direction === 'RISING' && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] text-red-400 font-semibold">⚠ RSI sobrecompra + VIX subiendo → alta probabilidad de caída</p>
                  </div>
                )}
                {result.vix_note && <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/20">{result.vix_note}</p>}
              </div>

              {/* Volumen / VWAP */}
              <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-2">
                <p className="text-[9px] font-semibold text-amber-400 uppercase tracking-wide flex items-center gap-1">
                  <BarChart2 className="w-3 h-3" />Volumen / VWAP
                </p>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${result.vwap_position === 'ABOVE' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : result.vwap_position === 'BELOW' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
                    {result.vwap_position === 'ABOVE' ? '▲ Sobre VWAP' : result.vwap_position === 'BELOW' ? '▼ Bajo VWAP' : '→ En VWAP'}
                  </span>
                  {result.vwap_value && <span className="text-[10px] font-mono text-foreground">${result.vwap_value?.toFixed(2)}</span>}
                </div>
                {result.volume_profile_note && <p className="text-[9px] text-muted-foreground">{result.volume_profile_note}</p>}
                {result.volume_note && <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/20">{result.volume_note}</p>}
              </div>

              {/* S&R / Liquidez */}
              <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-2">
                <p className="text-[9px] font-semibold text-emerald-400 uppercase tracking-wide flex items-center gap-1">
                  <Shield className="w-3 h-3" />Soporte & Resistencia
                </p>
                <Check val={result.price_at_support} label="Precio en soporte institucional" />
                <Check val={!result.price_at_resistance} label="Sin resistencia inmediata" />
                <Check val={!result.liquidity_sweep_detected} label="Sin barrido de liquidez reciente" />
                {result.institutional_level_note && (
                  <p className="text-[9px] text-foreground bg-secondary/40 rounded-lg px-2 py-1 border border-border/30">{result.institutional_level_note}</p>
                )}
                {result.sr_note && <p className="text-[9px] text-muted-foreground pt-1 border-t border-border/20">{result.sr_note}</p>}
              </div>
            </div>

            {/* Sentimiento */}
            <div className="bg-secondary/30 rounded-xl p-3 border border-border/40 space-y-3">
              <p className="text-[9px] font-semibold text-orange-400 uppercase tracking-wide flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />Sentimiento Macro
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="bg-secondary/50 rounded-lg p-2 border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Put/Call Ratio</p>
                  <p className={`text-sm font-bold font-mono ${result.put_call_ratio > 1.1 ? 'text-red-400' : result.put_call_ratio < 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {result.put_call_ratio?.toFixed(2) || '--'}
                  </p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Fed</p>
                  <p className="text-[9px] font-semibold text-foreground leading-tight">{result.fed_expectation || '--'}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Noticias Macro</p>
                  <p className={`text-xs font-bold ${result.macro_news_sentiment === 'POSITIVE' ? 'text-emerald-400' : result.macro_news_sentiment === 'NEGATIVE' ? 'text-red-400' : 'text-amber-400'}`}>
                    {result.macro_news_sentiment === 'POSITIVE' ? '✓ Positivas' : result.macro_news_sentiment === 'NEGATIVE' ? '✗ Negativas' : '~ Neutras'}
                  </p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2 border border-border/30">
                  <p className="text-[9px] text-muted-foreground">Capital Refugio</p>
                  <p className="text-[9px] font-semibold text-amber-400 leading-tight">{result.refuge_capital_flow || '--'}</p>
                </div>
              </div>
              {result.govt_type && (
                <div className="bg-secondary/20 rounded-lg px-2.5 py-2 border border-border/20 space-y-1.5">
                  <div>
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Gobierno EE.UU.: </span>
                    <span className="text-[9px] text-foreground">{result.govt_type}</span>
                  </div>
                  {result.macro_conflicts && (
                    <div>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Conflictos macro: </span>
                      <span className="text-[9px] text-foreground">{result.macro_conflicts}</span>
                    </div>
                  )}
                </div>
              )}
              {result.sentiment_note && <p className="text-[9px] text-muted-foreground">{result.sentiment_note}</p>}
            </div>

            {/* Summary */}
            <div className={`rounded-xl p-3 border ${regime?.border} ${regime?.bg}`}>
              <p className="text-[9px] font-semibold uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Activity className="w-3 h-3" />
                <span className={regime?.text}>Conclusión Macro</span>
              </p>
              <p className="text-[10px] text-foreground leading-relaxed">{result.summary}</p>
              {result.action_note && (
                <p className="text-[10px] text-muted-foreground italic mt-2 pt-2 border-t border-border/20">{result.action_note}</p>
              )}
            </div>

          </div>
        )}
      </CardContent>
    </Card>
  );
}