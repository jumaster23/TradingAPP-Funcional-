import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, RefreshCw, Save, Target, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { toast } from 'sonner';
import MacroScorecard from '../components/institutional/MacroScorecard';
import ConsensusPanel from '../components/trading/ConsensusPanel';
import { hasBase44Config, getBase44ConfigError, isNotFoundError, getReadableError } from '@/lib/backendGuard';
import { inferMlProbabilityFromPayload, upsertMlTradeSampleFromAnalysis } from '@/lib/mlDataset';

function getDefaultOiModeBySession() {
  try {
    const now = new Date();
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now).reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});

    const weekday = String(etParts.weekday || '');
    const hour = Number(etParts.hour || '0');
    const minute = Number(etParts.minute || '0');
    const mins = (hour * 60) + minute;
    const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
    const isRegularSession = mins >= (9 * 60 + 30) && mins <= (16 * 60);

    return isWeekday && isRegularSession ? 'near' : 'structural';
  } catch {
    return 'near';
  }
}

export default function Institutional() {
  const [ticker, setTicker] = useState('');
  const [strike, setStrike] = useState('');
  const [viewMode, setViewMode] = useState('institutional');
  const [oiViewMode, setOiViewMode] = useState(() => getDefaultOiModeBySession());
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState(null);

  const toNumber = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = Number(v.replace(/,/g, '').trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const composeInstitutionalData = ({ llmResult, gammaData, realPrices, vixData, clientPivots, now }) => {
    const base = { ...(llmResult || {}) };

    // Provider-first for critical levels to avoid LLM drift from real options data.
    const callWall = toNumber(gammaData?.call_wall) ?? toNumber(base.call_wall);
    const putWall = toNumber(gammaData?.put_wall) ?? toNumber(base.put_wall);
    const gammaLevel = toNumber(gammaData?.gamma_level) ?? toNumber(base.gamma_level) ?? (callWall && putWall ? Number(((callWall + putWall) / 2).toFixed(2)) : null);
    const gammaFlip = toNumber(base.gamma_flip) ?? gammaLevel;
    const maxPain = toNumber(gammaData?.max_pain) ?? toNumber(base.max_pain) ?? gammaLevel;

    const currentPrice = realPrices?.current_price ?? null;
    const vsGamma = currentPrice && gammaFlip
      ? (currentPrice > gammaFlip ? `Precio sobre Gamma Flip (+${((currentPrice - gammaFlip) / gammaFlip * 100).toFixed(2)}%)` : `Precio bajo Gamma Flip (${((currentPrice - gammaFlip) / gammaFlip * 100).toFixed(2)}%)`)
      : (base.price_vs_gamma || null);
    const vsCall = currentPrice && callWall
      ? `${((currentPrice - callWall) / callWall * 100).toFixed(2)}%`
      : (base.price_vs_call_wall || null);
    const vsPut = currentPrice && putWall
      ? `${((currentPrice - putWall) / putWall * 100).toFixed(2)}%`
      : (base.price_vs_put_wall || null);

    const intradayBias = currentPrice && gammaFlip
      ? (currentPrice > gammaFlip ? 'BULLISH' : currentPrice < gammaFlip ? 'BEARISH' : 'NEUTRAL')
      : (base.intraday_bias || 'NEUTRAL');

    const oiTotal = toNumber(gammaData?.open_interest_total);
    const normalizeKeyStrikes = (list) => {
      if (!Array.isArray(list)) return [];
      return list
        .map((ks) => {
          const strike = toNumber(ks?.strike);
          const callOi = toNumber(ks?.call_oi) ?? 0;
          const putOi = toNumber(ks?.put_oi) ?? 0;
          const totalOi = toNumber(ks?.total_oi) ?? (callOi + putOi);
          const callVolume = toNumber(ks?.call_volume) ?? toNumber(ks?.call_vol) ?? 0;
          const putVolume = toNumber(ks?.put_volume) ?? toNumber(ks?.put_vol) ?? 0;
          const totalVolume = toNumber(ks?.total_volume) ?? (callVolume + putVolume);
          return {
            strike,
            call_oi: callOi,
            put_oi: putOi,
            total_oi: totalOi,
            call_volume: callVolume,
            put_volume: putVolume,
            total_volume: totalVolume,
          };
        })
        .filter((ks) => ks.strike != null);
    };

    const llmKeyStrikes = normalizeKeyStrikes(base.key_strikes);
    const llmStructuralKeyStrikes = normalizeKeyStrikes(base.structural_key_strikes);
    const gammaKeyStrikes = normalizeKeyStrikes(gammaData?.key_strikes);
    const gammaStructuralKeyStrikes = normalizeKeyStrikes(gammaData?.structural_key_strikes);
    const gammaByStrike = new Map(gammaKeyStrikes.map((ks) => [ks.strike, ks]));

    const gammaHasActivity = hasNonZeroStrikeRows(gammaKeyStrikes);
    const baseKeyStrikes = gammaHasActivity
      ? gammaKeyStrikes
      : (llmKeyStrikes.length > 0 ? llmKeyStrikes : gammaKeyStrikes);
    let keyStrikes = baseKeyStrikes.map((ks) => {
      const gammaKs = gammaByStrike.get(ks.strike);
      const callOi = (ks.call_oi > 0 ? ks.call_oi : (gammaKs?.call_oi ?? ks.call_oi ?? 0));
      const putOi = (ks.put_oi > 0 ? ks.put_oi : (gammaKs?.put_oi ?? ks.put_oi ?? 0));
      const totalOi = (ks.total_oi > 0 ? ks.total_oi : (gammaKs?.total_oi ?? (callOi + putOi)));
      const callVolume = (ks.call_volume > 0 ? ks.call_volume : (gammaKs?.call_volume ?? ks.call_volume ?? 0));
      const putVolume = (ks.put_volume > 0 ? ks.put_volume : (gammaKs?.put_volume ?? ks.put_volume ?? 0));
      const totalVolume = (ks.total_volume > 0 ? ks.total_volume : (gammaKs?.total_volume ?? (callVolume + putVolume)));
      return {
        strike: ks.strike,
        call_oi: callOi,
        put_oi: putOi,
        total_oi: totalOi,
        call_volume: callVolume,
        put_volume: putVolume,
        total_volume: totalVolume,
      };
    });

    // If LLM key strikes are incomplete, inject missing high-OI strikes from provider data.
    gammaKeyStrikes.forEach((gks) => {
      if (!keyStrikes.some((ks) => ks.strike === gks.strike)) {
        keyStrikes.push(gks);
      }
    });

    const hasAnyOi = keyStrikes.some((ks) => (ks.call_oi || 0) > 0 || (ks.put_oi || 0) > 0 || (ks.total_oi || 0) > 0);
    const hasAnyVolume = keyStrikes.some((ks) => (ks.call_volume || 0) > 0 || (ks.put_volume || 0) > 0 || (ks.total_volume || 0) > 0);
    if (!hasAnyOi && !hasAnyVolume && gammaKeyStrikes.some((ks) => (ks.total_oi || 0) > 0 || (ks.total_volume || 0) > 0)) {
      keyStrikes = [...gammaKeyStrikes];
    }

    // Open interest table must reflect the strikes nearest to current price at analysis time.
    const ref = currentPrice ?? gammaLevel ?? (callWall && putWall ? (callWall + putWall) / 2 : null);
    if (ref) {
      keyStrikes = keyStrikes
        .sort((a, b) => {
          const distA = Math.abs((a.strike || 0) - ref);
          const distB = Math.abs((b.strike || 0) - ref);
          if (distA !== distB) return distA - distB;
          return (b.total_oi || 0) - (a.total_oi || 0);
        })
        .slice(0, 7);
      // Final display order: ascending by strike price
      keyStrikes = keyStrikes.sort((a, b) => (a.strike || 0) - (b.strike || 0));
    } else {
      keyStrikes = keyStrikes
        .sort((a, b) => (b.total_oi || 0) - (a.total_oi || 0))
        .slice(0, 7);
    }

    const structuralKeyStrikes = (
      gammaStructuralKeyStrikes.length > 0
        ? gammaStructuralKeyStrikes
        : (llmStructuralKeyStrikes.length > 0 ? llmStructuralKeyStrikes : [...keyStrikes].sort((a, b) => (b.total_oi || 0) - (a.total_oi || 0)).slice(0, 7))
    ).sort((a, b) => (a.strike || 0) - (b.strike || 0));

    const gexText = gammaData?.gamma_exposure || base.gamma_exposure || 'N/A';
    const oiText = (oiTotal != null ? oiTotal.toLocaleString() : null) || base.open_interest_total || 'N/A';

    const fallbackSummary = `Modo robusto institucional: niveles de opciones obtenidos de ${gammaData?.source || 'fuente local'}. Call Wall ${callWall ? `$${callWall.toFixed(2)}` : 'N/A'}, Put Wall ${putWall ? `$${putWall.toFixed(2)}` : 'N/A'}, Gamma Flip ${gammaFlip ? `$${gammaFlip.toFixed(2)}` : 'N/A'}, Max Pain ${maxPain ? `$${maxPain.toFixed(2)}` : 'N/A'}.`;
    const providerSummaryLine = `Niveles confirmados (${gammaData?.source || 'provider'}): Call Wall ${callWall ? `$${callWall.toFixed(2)}` : 'N/A'} | Put Wall ${putWall ? `$${putWall.toFixed(2)}` : 'N/A'} | Gamma ${gammaLevel ? `$${gammaLevel.toFixed(2)}` : 'N/A'} | Max Pain ${maxPain ? `$${maxPain.toFixed(2)}` : 'N/A'} | OI Total ${oiText}.`;

    const rangeWidth = callWall && putWall ? Math.abs(callWall - putWall) : null;
    const distToCall = currentPrice && callWall ? Math.abs(currentPrice - callWall) / currentPrice : null;
    const distToPut = currentPrice && putWall ? Math.abs(currentPrice - putWall) / currentPrice : null;
    const optionsSourceWeak = ['unavailable', 'estimated_from_spot'].includes(gammaData?.source || '');
    const vixRegime = vixData?.regime || null;
    const nearWall = (distToCall != null && distToCall < 0.003) || (distToPut != null && distToPut < 0.003);
    const broadRange = rangeWidth != null && currentPrice ? (rangeWidth / currentPrice) > 0.025 : false;
    const setupGrade = optionsSourceWeak ? 'C' : nearWall ? 'B' : (intradayBias !== 'NEUTRAL' && !broadRange && vixRegime !== 'EXTREME' ? 'A+' : 'B+');
    const sizeTier = setupGrade === 'A+' ? 'large' : setupGrade === 'C' ? 'small' : 'normal';
    const sizeGuidance = sizeTier === 'large'
      ? 'Usar tamaño grande (80-100% del tamaño base) cuando el precio esté claramente posicionado respecto al gamma flip y lejos de walls inmediatos.'
      : sizeTier === 'small'
        ? 'Usar tamaño bajo (25-40% del tamaño base): datos de opciones débiles/estimados o contexto institucional ambiguo.'
        : 'Usar tamaño normal (50-70% del tamaño base): estructura útil, pero sin ventaja institucional máxima.';
    const warning = optionsSourceWeak
      ? 'Los datos de opciones no son suficientemente sólidos para una lectura institucional A+.'
      : nearWall
        ? 'El precio está demasiado cerca de un wall; el movimiento puede frenarse o generar whipsaw.'
        : null;
    const contextMismatchExplanation = optionsSourceWeak
      ? 'El análisis institucional puede ser correcto en dirección, pero no en precisión operativa porque la fuente de opciones no es robusta.'
      : broadRange
        ? 'La estructura de opciones define un rango demasiado amplio: buena lectura estructural, pero mal contexto para ejecución agresiva.'
        : 'El contexto institucional es razonablemente coherente con la lectura de niveles del día.';

    const merged = {
      ...base,
      call_wall: callWall,
      put_wall: putWall,
      gamma_level: gammaLevel,
      gamma_flip: gammaFlip,
      max_pain: maxPain,
      gamma_exposure: gexText,
      open_interest_total: oiText,
      key_strikes: keyStrikes,
      structural_key_strikes: structuralKeyStrikes,
      price_vs_gamma: vsGamma,
      price_vs_call_wall: vsCall,
      price_vs_put_wall: vsPut,
      intraday_bias: intradayBias,
      summary: `${base.summary || fallbackSummary}\n\n${providerSummaryLine}`,
      market_maker_positioning: base.market_maker_positioning || 'Estimación local por OI: si el precio está sobre gamma flip, sesgo de estabilidad; bajo gamma flip, sesgo de mayor volatilidad.',
      setup_grade: setupGrade,
      entry_alert: warning,
      window_consensus: {
        overall_signal: intradayBias === 'BULLISH' ? 'CALL' : intradayBias === 'BEARISH' ? 'PUT' : 'NEUTRAL',
        intraday_bias: intradayBias,
        market_regime: vixRegime || 'N/A',
        dominant_direction: intradayBias === 'BULLISH' ? 'CALL' : intradayBias === 'BEARISH' ? 'PUT' : null,
        strong_contradiction: setupGrade === 'C',
        high_alignment: setupGrade === 'A+',
        size_tier: sizeTier,
        size_guidance: sizeGuidance,
        warning,
        context_mismatch_explanation: contextMismatchExplanation,
      },
    };

    merged.analysis_meta = {
      source_window: 'institutional',
      overall_signal: merged.window_consensus.overall_signal,
      setup_grade: setupGrade,
      entry_alert: warning,
      execution_tier: sizeTier,
      size_tier: sizeTier,
      size_guidance: sizeGuidance,
      context_mismatch_explanation: contextMismatchExplanation,
      market_regime: vixRegime || 'N/A',
      options_source: gammaData?.source || 'unavailable',
    };

    if (clientPivots) {
      Object.assign(merged, clientPivots);
    }

    merged._current_price = currentPrice;
    merged._today_open = realPrices?.today_open ?? null;
    merged._volume = realPrices?.volume ?? null;
    merged._vix = vixData?.vix ?? null;
    merged._vix_change = vixData?.vix_change ?? null;
    merged._analysisTime = now.toISOString();
    merged._options_source = gammaData?.source || 'unavailable';
    merged._options_expiration = gammaData?.options_expiration || null;
    merged._options_sample_size = toNumber(gammaData?.strikes_analyzed) || 0;
    merged._put_call_ratio = toNumber(gammaData?.put_call_ratio) ?? null;
    merged._oi_call_dominant = gammaData?.oi_call_dominant ?? null;
    merged._total_call_oi = toNumber(gammaData?.total_call_oi) ?? null;
    merged._total_put_oi = toNumber(gammaData?.total_put_oi) ?? null;

    return merged;
  };

  const hasNonZeroStrikeRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows.some((r) =>
      (toNumber(r?.call_oi) ?? 0) > 0 ||
      (toNumber(r?.put_oi) ?? 0) > 0 ||
      (toNumber(r?.total_oi) ?? 0) > 0 ||
      (toNumber(r?.call_volume) ?? 0) > 0 ||
      (toNumber(r?.put_volume) ?? 0) > 0 ||
      (toNumber(r?.total_volume) ?? 0) > 0
    );
  };

  const analyze = async () => {
    if (!ticker) return;
    if (!hasBase44Config()) {
      toast.error(getBase44ConfigError());
      return;
    }
    setIsLoading(true);
    const t = ticker.toUpperCase();
    try {
      // Fetch real prices + VIX in parallel for maximum freshness
      const [priceResult, vixResult, gammaResult] = await Promise.allSettled([
        base44.functions.invoke('getStockPrice', { ticker: t }),
        base44.functions.invoke('getVix', {}),
        base44.functions.invoke('getGammaOI', { ticker: t, force_refresh: true }),
      ]);
      const realPrices = priceResult?.status === 'fulfilled' ? priceResult.value?.data : null;
      const vixData = vixResult?.status === 'fulfilled' ? vixResult.value?.data : null;
      const gammaData = gammaResult?.status === 'fulfilled' ? gammaResult.value?.data : null;

      const now = new Date();
      const nowISO = now.toISOString();
      const nowLocal = now.toLocaleString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

      // Compute pivot points client-side if we have real prices
      let clientPivots = null;
      if (realPrices?.prev_close && realPrices?.today_high && realPrices?.today_low) {
        const H = realPrices.today_high;
        const L = realPrices.today_low;
        const C = realPrices.prev_close;
        const PP = (H + L + C) / 3;
        clientPivots = {
          prev_high: H, prev_low: L, prev_close: C,
          pivot_point: PP,
          r1: 2 * PP - L, r2: PP + (H - L), r3: H + 2 * (PP - L),
          s1: 2 * PP - H, s2: PP - (H - L), s3: L - 2 * (H - PP),
        };
      }

      const priceHint = realPrices
        ? `⚠️ PRECIOS REALES DE ${t} — YAHOO FINANCE — OBTENIDOS JUSTO AHORA (${nowLocal}):
current_price = $${realPrices.current_price} (ESTE ES EL PRECIO ACTUAL AL MINUTO)
prev_close = $${realPrices.prev_close}
today_open = $${realPrices.today_open}
today_high = $${realPrices.today_high}
today_low = $${realPrices.today_low}
volume = ${realPrices.volume?.toLocaleString() || 'N/A'}

USA ESTOS PRECIOS EXACTOS para los cálculos de pivotes y para ubicar al precio actual respecto a los niveles gamma/OI.`
        : `No se pudo obtener precios reales. Obtén precios de ${t} de Yahoo Finance al momento actual.`;

      const vixHint = vixData && !vixData.error
        ? `VIX REAL AHORA (${nowLocal}): ${vixData.vix} (cambio: ${vixData.vix_change > 0 ? '+' : ''}${vixData.vix_change?.toFixed(2)}, ${vixData.vix_change_pct?.toFixed(2)}%) — Régimen: ${vixData.regime}`
        : '';

      let llmResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Eres un analista institucional de opciones. Fecha y hora EXACTA de este análisis: ${nowISO} (${nowLocal}).

${priceHint}

${vixHint}

═════════════════════════════════════════════════
IMPORTANTE: TODOS los datos de gamma, OI, call_wall, put_wall, max_pain y key_strikes 
DEBEN ser del DÍA DE HOY ${nowISO.slice(0,10)}. Si no encuentras datos de hoy, indica 
explícitamente en el summary que los datos pueden no estar actualizados.
═════════════════════════════════════════════════

Analiza ${t}${strike ? ` (strike de referencia: ${strike})` : ''}.

FUENTES — CONSULTAR TODAS (datos de HOY):

OPCIONES Y GAMMA:
1. https://www.barchart.com/stocks/quotes/${t}/options — cadena de opciones completa, OI por strike
2. https://www.barchart.com/stocks/quotes/${t}/put-call-ratios — ratio put/call y OI total
3. https://www.unusualwhales.com/flow/${t} — flujo de opciones inusual, gamma flip
4. https://finance.yahoo.com/quote/${t}/options — opciones de Yahoo como respaldo

ANÁLISIS FUNDAMENTAL E INSTITUCIONAL:
5. https://finviz.com/quote.ashx?t=${t} — precio target de analistas, short float, institucional %, insider %, P/E, EPS, sector, recomendación de analistas
6. https://www.tipranks.com/stocks/${t.toLowerCase()}/forecast — consenso de analistas, Smart Score, actividad de insiders, fondos de cobertura (hedge funds), upside %
7. https://www.barchart.com/stocks/quotes/${t}/analyst-ratings — calificaciones de analistas de Barchart

DATOS A EXTRAER (DEBEN ser datos de HOY — NO datos de días anteriores):

GAMMA & OPTIONS (de Barchart/Unusualwhales — HOY):
- call_wall: strike con MAYOR open interest acumulado de CALLS hoy. Es resistencia magnética.
- put_wall: strike con MAYOR open interest acumulado de PUTS hoy. Es soporte magnético.
- gamma_flip: nivel donde el Gamma Exposure (GEX) cambia de positivo a negativo. Si no disponible, estimar como punto entre call_wall y put_wall donde el dealer cambia de posición.
- gamma_level: strike con mayor concentración de gamma absoluta cerca del precio actual ($${realPrices?.current_price || '?'})
- max_pain: precio de max pain del vencimiento más próximo
- gamma_exposure: GEX total estimado (positivo = dealers long gamma = estable / negativo = short gamma = volátil)
- open_interest_total: OI total del ticker

CONTEXTO DE PRECIO ACTUAL vs NIVELES:
- price_vs_gamma: ¿el precio actual ($${realPrices?.current_price || '?'}) está SOBRE o BAJO el gamma_flip? Esto determina la dinámica de volatilidad.
- price_vs_call_wall: distancia en % del precio actual al call_wall
- price_vs_put_wall: distancia en % del precio actual al put_wall
- intraday_bias: "BULLISH" si precio > gamma_flip, "BEARISH" si precio < gamma_flip, "NEUTRAL" si está justo en el gamma_flip

PIVOTE — USA LOS PRECIOS REALES provistos arriba sin modificarlos:
pivot_point = (prev_high + prev_low + prev_close) / 3
r1 = (2 × pivot_point) - prev_low
r2 = pivot_point + (prev_high - prev_low)
r3 = prev_high + 2 × (pivot_point - prev_low)
s1 = (2 × pivot_point) - prev_high
s2 = pivot_point - (prev_high - prev_low)
s3 = prev_low - 2 × (prev_high - pivot_point)

KEY STRIKES ⚠️ CRÍTICO — DATOS EN TIEMPO REAL DE BARCHART:
Abre https://www.barchart.com/stocks/quotes/${t}/options AHORA MISMO y lee la cadena de opciones actualizada al momento ${nowISO}.
NO uses datos cacheados ni de días anteriores. Los OI y volúmenes DEBEN ser los que aparecen en Barchart en este momento.

Criterio de selección:
  1. PROXIMIDAD AL PRECIO ACTUAL ($${realPrices?.current_price || '?'}): prioriza strikes dentro del rango ±5% del precio actual (es decir, entre $${realPrices?.current_price ? (realPrices.current_price * 0.95).toFixed(0) : '?'} y $${realPrices?.current_price ? (realPrices.current_price * 1.05).toFixed(0) : '?'}).
  2. MAYOR OI dentro de ese rango: de los strikes cercanos, toma los de mayor Open Interest actual.
  3. SIEMPRE incluye el strike exacto del call_wall (mayor OI en calls de toda la cadena) y el del put_wall (mayor OI en puts de toda la cadena), aunque estén fuera del rango ±5%.
  4. Devuelve entre 5 y 7 strikes ordenados de MENOR a MAYOR precio de strike.
  5. Para cada strike, extrae de Barchart el OI y volumen DE HOY (no de vencimientos pasados):
     - call_oi: Open Interest actual en calls en ese strike
     - put_oi: Open Interest actual en puts en ese strike
     - total_oi = call_oi + put_oi
     - call_volume: volumen de contratos call negociados HOY en ese strike
     - put_volume: volumen de contratos put negociados HOY en ese strike
     - total_volume = call_volume + put_volume

SENTIMENT INSTITUCIONAL (de Finviz + TipRanks + Barchart analysts):
- analyst_consensus: consenso general de analistas: "STRONG BUY", "BUY", "HOLD", "SELL" o "STRONG SELL"
- analyst_price_target: precio objetivo promedio de analistas (número)
- analysts_count: cantidad de analistas que cubren el ticker (número)
- analyst_upside_pct: upside % desde el precio actual ($${realPrices?.current_price || '?'}) al price target promedio
- institutional_ownership_pct: % de acciones en manos institucionales (número, ej: 72.5)
- short_float_pct: % de float en posiciones cortas (número, ej: 1.8)
- insider_activity: actividad de insiders reciente: "BUYING", "SELLING" o "NEUTRAL"
- hedge_fund_activity: cambio neto en posiciones de hedge funds: "INCREASING", "DECREASING" o "NEUTRAL"
- smart_score: TipRanks Smart Score del 1 al 10 (número; null si no disponible)
- earnings_date: próxima fecha de earnings si se conoce (string, ej: "15 Apr 2026" o null)

market_maker_positioning: En español — párrafo detallado de 5-7 oraciones estructurado así:
  1. Posición GEX ACTUAL: "Los Market Makers se encuentran en posición de Gamma [Positiva/Negativa] (Long/Short Gamma). La Exposición Gamma Neta (GEX) estimada es de [gamma_exposure — menciona el valor numérico completo, ej: +$3.2 Billion si está disponible]. El precio actual de $[precio] se sitúa [X puntos / Y%] [por encima/por debajo] del Gamma Flip en ~$[gamma_level]."
  2. NIVELES QUE DEFIENDEN HOY: "Los dealers están defendiendo activamente tres niveles estructurales: (a) Call Wall $[call_wall] — nivel de resistencia donde los MM tienen la mayor concentración de calls vendidas ([OI si disponible] contratos); deben comprar [subyacente] mecánicamente si el precio sube hacia este nivel. (b) Put Wall $[put_wall] — soporte donde los dealers tienen la mayor concentración de puts vendidas; deben vender [subyacente] si el precio cae hacia aquí, amplificando el movimiento. (c) Gamma Flip ~$[gamma_level] — la línea Maginot del día: mientras el precio se mantenga sobre ella, el GEX es positivo y los dealers actúan como estabilizadores."
  3. CÓMO ESTÁN ACTUANDO AHORA: "Con el precio en $[precio] [sobre/bajo] el Gamma Flip, el régimen actual es [ESTABILIZADOR: los dealers compran en caídas y venden en rallies, comprimiendo la volatilidad / AMPLIFICADOR: los dealers venden en caídas y compran en subidas, expandiendo la volatilidad]. El rango de movimiento esperado mientras no haya ruptura de niveles clave es de [put_wall a call_wall, X puntos]."
  4. CONCLUSIÓN DE 1 ORACIÓN sobre el nivel más crítico a vigilar en la próxima hora.

═══════════════════════════════════════
ANÁLISIS INTERPRETATIVO (campos obligatorios, en español):
═══════════════════════════════════════

day_analysis: ANÁLISIS DEL DÍA — texto completo estructurado de la siguiente manera, SIN omitir ninguna sección:

"📅 ANÁLISIS INSTITUCIONAL ${t} — ${nowLocal}
Fuente de datos de opciones: Barchart (https://www.barchart.com/stocks/quotes/${t}/options)

▶ PRECIO ACTUAL: $[precio actual] | Apertura: $[today_open] | Cierre anterior: $[prev_close] | VIX: [vix]

▶ NIVELES CLAVE DE OPCIONES (OI estructural de hoy):
  • C = Call Wall $[call_wall] → Strike con MAYOR Open Interest en Calls de toda la cadena ([call_wall_oi] contratos). Resistencia magnética: los MM que están short delta en esas calls DEBEN comprar el subyacente si el precio se acerca, frenando el movimiento. Si el precio rompe y cierra sobre este nivel, el hedging se invierte y puede acelerar la subida.
  • P = Put Wall $[put_wall] → Strike con MAYOR Open Interest en Puts ([put_wall_oi] contratos). Soporte magnético: los MM short en esas puts deben vender el subyacente si el precio cae, amplificando la presión bajista. Zona de alta reflexión en rebotes.
  • Gamma Flip / Gamma Level ≈ $[gamma_level] → Promedio aritmético entre Call Wall y Put Wall. Por encima: régimen de baja volatilidad (dealers compran en caídas). Por debajo: régimen de alta volatilidad (dealers venden en caídas). ⚠️ Aproximación — no es GEX real.
  • Max Pain = $[max_pain] → Precio donde los compradores de opciones del vencimiento más próximo pierden el máximo valor. El precio tiende a gravitar hacia este nivel en expiraciones. Distancia actual: [X] puntos ([Y]%).

▶ POSICIÓN DEL PRECIO vs NIVELES:
  • Precio ($[precio]) vs Call Wall ($[call_wall]): [distancia en $ y %]. [Interpretación: si está por debajo → espacio al alza hasta resistencia; si está por encima → puede haber follow-through alcista]
  • Precio vs Put Wall ($[put_wall]): [distancia en $ y %]. [Interpretación]
  • Precio vs Gamma Level ($[gamma_level]): [sobre/bajo el flip → implicación de régimen]
  • Precio vs Max Pain ($[max_pain]): [distancia en $ y %].

▶ SESGO INTRADAY: [BULLISH/BEARISH/NEUTRAL] — [explicación de 1-2 oraciones por qué]

▶ RANGO OPERATIVO ESPERADO HOY:
  • Límite superior inmediato: $[nivel — R1 o call_wall, el que esté más cercano arriba]
  • Soporte inmediato: $[nivel — S1 o put_wall, el que esté más cercano abajo]
  • Escenario alcista: Si supera $[call_wall o R1], siguiente objetivo $[R2 o siguiente resistencia]
  • Escenario bajista: Si pierde $[put_wall o S1], siguiente objetivo $[S2 o siguiente soporte]
  • Zona de máximo peligro/oportunidad: entre $[put_wall] y $[call_wall]"

market_maker_comment: COMENTARIO DE LOS MM (Market Makers) — texto estructurado completo:

"🏦 POSICIÓN DE LOS MARKET MAKERS — ${t} (${nowLocal})
Fuente GEX/OI: https://www.barchart.com/stocks/quotes/${t}/options y https://www.barchart.com/stocks/quotes/${t}/put-call-ratios

▶ EXPOSICIÓN GAMMA (GEX) HOY:
  • GEX estimado: [gamma_exposure de Barchart si disponible, o descripción cualitativa]
  • Régimen: [LONG GAMMA si GEX > 0 / SHORT GAMMA si GEX < 0]
  • Implicación del régimen: Si GEX positivo (dealers LONG gamma) → los dealers compran en caídas y venden en subidas, actuando como estabilizadores. El rango del día tiende a ser estrecho. Si GEX negativo (dealers SHORT gamma) → los dealers amplifican los movimientos (venden en caídas, compran en subidas), lo que genera mayor volatilidad y movimientos rápidos.

▶ CÓMO ACTUARÁN LOS DEALERS HOY:
  • Respecto al Call Wall ($[call_wall]): Los MM que vendieron calls aquí están SHORT DELTA. Si el precio sube hacia $[call_wall], deben COMPRAR [subyacente] para hedgear (compra de delta). Esto crea compra mecánica que puede frenar el avance. Si el precio ROMPE sobre $[call_wall], el hedging se acelera exponencialmente (gamma squeeze alcista).
  • Respecto al Put Wall ($[put_wall]): Los MM que vendieron puts aquí están LONG DELTA. Si el precio cae hacia $[put_wall], deben VENDER [subyacente] para hedgear (venta de delta). Esto amplifica la caída. Un rebote fuerte desde $[put_wall] puede disparar compra de cobertura.
  • Zona entre Put Wall y Call Wall ($[put_wall] - $[call_wall]): Rango donde el hedging de los dealers es más activo y equilibrado. El precio tiende a oscilar dentro de este rango mientras no haya catalizador externo.

▶ RATIO PUT/CALL HOY:
  • P/C Ratio: [put_call_ratio] → [si > 1.0: "Mercado defensivo — mayor OI en Puts que en Calls. Los dealers tienen más obligaciones bajistas. Sesgo protector en el mercado." / si < 1.0: "Sesgo alcista — mayor OI en Calls. Los dealers tienen más exposición gamma en calls, lo cual amplifica las subidas." / si ≈ 1.0: "Equilibrado"]
  • Dominancia OI: [CALLS / PUTS dominan] — OI total Calls: [X] | OI total Puts: [Y]

▶ CONCLUSIÓN OPERATIVA PARA LOS DEALERS:
  [2-3 oraciones describiendo qué acción concreta tomarán los dealers según el escenario más probable del día, usando todos los datos anteriores]

⚠️ LIMITACIÓN TÉCNICA: El gamma_level ($[gamma_level]) es una APROXIMACIÓN SIMPLE calculada como (call_wall + put_wall) / 2. NO es un GEX calculado con greeks individuales por strike. Para GEX real consultar SpotGamma o Barchart Options Analysis."

summary: En español — resumen ejecutivo NARRATIVO y DETALLADO. NO es una lista de datos, es un análisis interpretativo que explica qué puede pasar y por qué. ESTRUCTURA OBLIGATORIA:

"📊 RESUMEN EJECUTIVO — ${t} — ${nowLocal}

[CONTEXTO DE MERCADO] El precio de ${t} se encuentra en $[precio] ([+/-X%] vs cierre anterior $[prev_close]), con el VIX en [vix] indicando un régimen de [alta/media/baja] volatilidad. [1-2 oraciones describiendo el contexto macro/sectorial del día si es relevante.]

[ESTRUCTURA DE OPCIONES — BARCHART ${nowISO.slice(0,10)}] La cadena de opciones muestra un Call Wall en $[call_wall] con [X] contratos de OI y un Put Wall en $[put_wall] con [Y] contratos. Esto define el rango magnético del día entre $[put_wall] y $[call_wall] ([Z] puntos de amplitud). El Gamma Flip estimado en ~$[gamma_level] actúa como la línea divisoria: [el precio está X puntos SOBRE/BAJO este nivel → implicación concreta]. Max Pain del vencimiento más próximo: $[max_pain] ([distancia al precio actual]).

[ESCENARIOS Y NIVELES — QUÉ PUEDE PASAR]
• Si el precio mantiene y supera $[nivel inmediato alcista: R1 o call_wall]:  los dealers que vendieron calls en $[call_wall] deberán acelerar su compra de delta, lo que puede crear un efecto de gamma squeeze y llevar el precio hacia $[siguiente nivel: R2]. Volumen confirmatorio requerido.
• Si el precio pierde $[nivel inmediato bajista: S1 o put_wall]: los dealers con puts vendidas en $[put_wall] deberán vender el subyacente para mantener cobertura, amplificando la caída hacia $[S2]. Zona de alto riesgo bajista.
• Zona de consolidación esperada: entre $[put_wall] y $[call_wall]. Dentro de este rango los dealers operan neutralizando movimientos — rango chop/lateral probable sin catalizador externo.
• Max Pain a $[max_pain] actúa como imán de vencimiento: [si el precio está lejos → tendencia a gravitar / si está cerca → posible anclaje esta semana].

[POSICIONAMIENTO DE LOS MARKET MAKERS — GEX Y NIVELES DEFENDIDOS]
A la hora de este análisis (${nowLocal}), el precio de $[precio] se encuentra [X puntos sobre/bajo] el Gamma Flip de $[gamma_level], lo que coloca a los dealers en régimen de Gamma [Positiva/Negativa]. La Exposición Gamma Neta estimada es [gamma_exposure — valor completo en dólares si disponible]. Los dealers están defendiendo activamente: (1) Call Wall $[call_wall] — la mayor concentración de calls vendidas de la cadena; si el precio sube hacia aquí, los MM deben comprar [subyacente] para mantener cobertura delta, lo que puede frenar el avance o crear un gamma squeeze si se rompe. (2) Put Wall $[put_wall] — la mayor concentración de puts vendidas; si el precio cae a este nivel, los dealers deben vender [subyacente], amplificando cualquier movimiento bajista. Con un ratio P/C de [ratio], el mercado tiene sesgo [defensivo con más cobertura en puts / alcista con más OI en calls]. [CALLS/PUTS] dominan el OI total con [X] contratos vs [Y] contratos del lado contrario. En este régimen de Gamma [Positiva → los dealers actúan como amortiguadores, el rango esperado es estrecho entre $[put_wall] y $[call_wall] / Negativa → los movimientos se amplifican y los breakouts tienden a acelerarse].

[POSICIONAMIENTO INSTITUCIONAL] Analistas con consenso [consenso] y target promedio $[price_target] ([upside]% upside, [X] analistas). Propiedad institucional: [%]. Short float: [%] ([alto riesgo de short squeeze si >15% / normal si <5%]). Smart Score TipRanks: [X]/10. Insiders: [BUYING → señal alcista / SELLING → precaución / NEUTRAL]. Hedge funds: [INCREASING/DECREASING/NEUTRAL]. [Próx. earnings: [fecha] — eventos de riesgo binario a monitorear / No hay earnings próximos.]

[CONCLUSIÓN Y ACCIÓN] Sesgo del día: [BULLISH/BEARISH/NEUTRAL]. [2-3 oraciones de recomendación operativa concreta: punto de entrada óptimo, nivel objetivo y stop loss sugerido basado en la estructura de OI. Si NEUTRAL: indicar condición que activaría el trade.]"

TODOS los textos DEBEN estar en español.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            gamma_level: { type: 'number' },
            call_wall: { type: 'number' },
            put_wall: { type: 'number' },
            gamma_flip: { type: 'number' },
            gamma_exposure: { type: 'string' },
            open_interest_total: { type: 'string' },
            prev_high: { type: 'number' },
            prev_low: { type: 'number' },
            prev_close: { type: 'number' },
            pivot_point: { type: 'number' },
            r1: { type: 'number' }, r2: { type: 'number' }, r3: { type: 'number' },
            s1: { type: 'number' }, s2: { type: 'number' }, s3: { type: 'number' },
            max_pain: { type: 'number' },
            price_vs_gamma: { type: 'string' },
            price_vs_call_wall: { type: 'string' },
            price_vs_put_wall: { type: 'string' },
            intraday_bias: { type: 'string', enum: ['BULLISH', 'BEARISH', 'NEUTRAL'] },
            key_strikes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  strike: { type: 'number' },
                  call_oi: { type: 'number' },
                  put_oi: { type: 'number' },
                  total_oi: { type: 'number' },
                  call_volume: { type: 'number' },
                  put_volume: { type: 'number' },
                  total_volume: { type: 'number' }
                },
                required: ['strike', 'call_oi', 'put_oi', 'total_oi', 'call_volume', 'put_volume', 'total_volume']
              }
            },
            analyst_consensus: { type: 'string', enum: ['STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'] },
            analyst_price_target: { type: 'number' },
            analysts_count: { type: 'number' },
            analyst_upside_pct: { type: 'number' },
            institutional_ownership_pct: { type: 'number' },
            short_float_pct: { type: 'number' },
            insider_activity: { type: 'string', enum: ['BUYING', 'SELLING', 'NEUTRAL'] },
            hedge_fund_activity: { type: 'string', enum: ['INCREASING', 'DECREASING', 'NEUTRAL'] },
            smart_score: { type: 'number' },
            earnings_date: { type: 'string' },
            market_maker_positioning: { type: 'string' },
            day_analysis: { type: 'string' },
            market_maker_comment: { type: 'string' },
            summary: { type: 'string' }
          }
        }
      });

      const providerHasActivity = hasNonZeroStrikeRows(gammaData?.key_strikes);
      const llmHasActivity = hasNonZeroStrikeRows(llmResult?.key_strikes);
      if (!providerHasActivity && !llmHasActivity) {
        try {
          const oiOnly = await base44.integrations.Core.InvokeLLM({
            prompt: `Extrae SOLO open interest y volumen por strike para ${t} en opciones del día de hoy ${nowISO.slice(0, 10)}.

Fuentes prioritarias:
1) https://www.barchart.com/stocks/quotes/${t}/options
2) https://finance.yahoo.com/quote/${t}/options

Devuelve exactamente 5 strikes con mayor OI total y completa SIEMPRE estos campos numéricos por fila:
- strike
- call_oi
- put_oi
- total_oi = call_oi + put_oi
- call_volume
- put_volume
- total_volume = call_volume + put_volume

Si una fuente no muestra CALL o PUT para un strike, usa 0 solo en ese lado. No devuelvas texto fuera del JSON.`,
            add_context_from_internet: true,
            model: 'gemini_3_flash',
            response_json_schema: {
              type: 'object',
              properties: {
                key_strikes: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    properties: {
                      strike: { type: 'number' },
                      call_oi: { type: 'number' },
                      put_oi: { type: 'number' },
                      total_oi: { type: 'number' },
                      call_volume: { type: 'number' },
                      put_volume: { type: 'number' },
                      total_volume: { type: 'number' }
                    },
                    required: ['strike', 'call_oi', 'put_oi', 'total_oi', 'call_volume', 'put_volume', 'total_volume']
                  }
                }
              },
              required: ['key_strikes']
            }
          });

          if (hasNonZeroStrikeRows(oiOnly?.key_strikes)) {
            llmResult = {
              ...llmResult,
              key_strikes: oiOnly.key_strikes,
            };
          }
        } catch {
          // Keep existing merged fallback when focused OI extraction fails.
        }
      }

      const merged = composeInstitutionalData({
        llmResult,
        gammaData,
        realPrices,
        vixData,
        clientPivots,
        now,
      });

      try {
        const ml = await inferMlProbabilityFromPayload(merged, { sourceWindow: 'institutional', ticker: t });
        if (ml) {
          merged.ml = ml;
          if (!merged.analysis_meta) merged.analysis_meta = {};
          merged.analysis_meta.ml_probability = ml.ml_probability;
          merged.analysis_meta.ml_threshold = ml.threshold;
          merged.analysis_meta.ml_pass_filter = ml.pass_filter;
          merged.analysis_meta.ml_samples = ml.samples_used;
          merged.analysis_meta.ml_confidence = ml.confidence_tier;
          if (merged.window_consensus) {
            merged.window_consensus.ml_probability = ml.ml_probability;
            merged.window_consensus.ml_filter = ml.pass_filter;
            merged.window_consensus.ml_samples = ml.samples_used;
            merged.window_consensus.ml_note = ml.note;
          }
          if (ml.pass_filter === false) {
            merged.entry_alert = [merged.entry_alert, `Filtro ML: probabilidad ${(ml.ml_probability * 100).toFixed(1)}% (< ${(ml.threshold * 100).toFixed(0)}%). Lectura institucional válida en modo defensivo.`].filter(Boolean).join(' ');
          }
        }
      } catch (mlErr) {
        console.warn('ML inference failed for Institutional:', mlErr?.message || mlErr);
      }

      setData(merged);
      toast.success(`Niveles institucionales de ${t}`);
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('Error 404: faltan funciones backend para análisis institucional.');
      } else {
        toast.error('Error al analizar: ' + getReadableError(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const saveData = async () => {
    if (!data) return;
    if (!hasBase44Config()) {
      toast.error('No se puede guardar: falta configurar Base44 en .env.local');
      return;
    }
    try {
      const savedAnalysis = await base44.entities.Analysis.create({
        ticker, type: 'institutional',
        analysis_data: JSON.stringify(data),
        last_updated: new Date().toLocaleString(),
      });
      try {
        await upsertMlTradeSampleFromAnalysis(savedAnalysis);
      } catch (syncErr) {
        console.warn('ML dataset sync failed for Institutional:', syncErr?.message || syncErr);
      }
      toast.success('Guardado');
    } catch (err) {
      if (isNotFoundError(err)) {
        toast.error('No se pudo guardar: la entidad Analysis no existe en el backend Base44.');
      } else {
        toast.error('Error al guardar: ' + getReadableError(err));
      }
    }
  };

  const LevelRow = ({ label, value, color }) => (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold font-mono ${color || 'text-foreground'}`}>${value?.toFixed(2) || '---'}</span>
    </div>
  );

  const getSourceBadge = (source) => {
    if (source === 'cboe') return { label: 'Fuente opciones: Barchart/CBOE', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
    if (source === 'yahoo_options') return { label: 'Fuente opciones: Yahoo Finance', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
    if (source === 'estimated_from_spot') return { label: 'Fuente opciones: Estimado por precio spot', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' };
    return { label: 'Fuente opciones: No disponible (estimado local)', cls: 'bg-red-500/10 text-red-400 border-red-500/30' };
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-xl border border-border/50">
        <Input placeholder="Ticker (ej: SPY)" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="flex-1 min-w-[150px] bg-secondary border-border font-mono" />
        <Input placeholder="Strike (opcional)" value={strike} onChange={(e) => setStrike(e.target.value)} className="w-32 bg-secondary border-border font-mono" />
        <Button onClick={analyze} disabled={isLoading || !ticker} className="bg-primary hover:bg-primary/90">
          <Search className="w-4 h-4 mr-2" />Analizar
        </Button>
        <Button variant="outline" onClick={analyze} disabled={isLoading}><RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />Actualizar</Button>
        <Button variant="outline" onClick={saveData}><Save className="w-4 h-4 mr-2" />Guardar</Button>
        <Button variant="outline" onClick={analyze}><Target className="w-4 h-4 mr-2" />Buscar Strike</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'institutional' ? 'default' : 'outline'}
            onClick={() => setViewMode('institutional')}
          >
            Vista Institucional
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === 'macro' ? 'default' : 'outline'}
            onClick={() => setViewMode('macro')}
          >
            Vista Macro
          </Button>
        </div>
      </div>

      {viewMode === 'macro' && (
        <div className="space-y-3">
          <div className="p-4 bg-card rounded-xl border border-border/50">
            <p className="text-xs text-muted-foreground">Sección Macro activada: aquí puedes revisar el contexto de régimen y riesgo macro antes de ejecutar el análisis institucional.</p>
          </div>
          <MacroScorecard />
        </div>
      )}

      {viewMode === 'institutional' && isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Obteniendo niveles institucionales...</p>
          </div>
        </div>
      )}

      {viewMode === 'institutional' && data && !isLoading && (
        <div className="space-y-6">

          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-secondary/20 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Panel Institucional</p>
                <div className="mt-1 flex items-center gap-3">
                  <h2 className="text-2xl font-bold font-mono text-primary">{ticker || '--'}</h2>
                  <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${getSourceBadge(data._options_source).cls}`}>
                    {getSourceBadge(data._options_source).label}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Strikes analizados</p>
                <p className="text-base font-mono font-semibold">{data._options_sample_size || 0}</p>
                {data._options_expiration && (
                  <p className="text-[10px] text-muted-foreground mt-1">Vencimiento: {data._options_expiration}</p>
                )}
                {data._analysisTime && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(data._analysisTime).toLocaleString('es-BO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Precio Actual</p>
                <p className="text-2xl font-bold font-mono text-primary mt-1">{data._current_price ? `$${data._current_price.toFixed(2)}` : '--'}</p>
                {data._today_open && data._current_price && (
                  <p className={`text-[10px] font-semibold mt-1 ${data._current_price >= data._today_open ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data._current_price >= data._today_open ? '▲' : '▼'} {((data._current_price - data._today_open) / data._today_open * 100).toFixed(2)}%
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sesgo Intraday</p>
                <div className="flex items-center gap-2 mt-1">
                  {data.intraday_bias === 'BULLISH' ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : data.intraday_bias === 'BEARISH' ? <TrendingDown className="w-4 h-4 text-red-400" /> : <Minus className="w-4 h-4 text-amber-400" />}
                  <span className={`text-lg font-bold ${data.intraday_bias === 'BULLISH' ? 'text-emerald-400' : data.intraday_bias === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>{data.intraday_bias || '--'}</span>
                </div>
                {data.price_vs_gamma && <p className="text-[10px] text-muted-foreground mt-1">{data.price_vs_gamma}</p>}
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">VIX</p>
                <p className={`text-xl font-bold font-mono mt-1 ${data._vix < 20 ? 'text-emerald-400' : data._vix < 25 ? 'text-amber-400' : 'text-red-400'}`}>{data._vix?.toFixed(2) || '--'}</p>
                {data._vix_change != null && (
                  <p className={`text-[10px] font-semibold mt-1 ${data._vix_change <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {data._vix_change > 0 ? '+' : ''}{data._vix_change.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border/50 bg-secondary/20 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Volumen Spot</p>
                <p className="text-xl font-bold font-mono mt-1">{data._volume ? (data._volume >= 1e6 ? `${(data._volume / 1e6).toFixed(1)}M` : data._volume.toLocaleString()) : '--'}</p>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{data._analysisTime ? new Date(data._analysisTime).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}</span>
                </div>
              </div>
            </div>
          </div>

          <ConsensusPanel
            title="Consenso Institucional"
            consensus={data.window_consensus}
            setupGrade={data.setup_grade}
            entryAlert={data.entry_alert}
          />

          {/* Resumen Ejecutivo */}
          <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-border/40 bg-secondary/20">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">📋 Resumen Ejecutivo</span>
              <div className="flex flex-wrap items-center gap-4 text-[11px]">
                {data.gamma_exposure && data.gamma_exposure !== 'N/A' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground uppercase tracking-wide text-[10px]">GEX</span>
                    <span className={`font-mono font-bold text-sm ${String(data.gamma_exposure).startsWith('+') ? 'text-emerald-400' : String(data.gamma_exposure).startsWith('-') ? 'text-red-400' : 'text-primary'}`}>
                      {data.gamma_exposure}
                    </span>
                  </div>
                )}
                {data.open_interest_total && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground uppercase tracking-wide text-[10px]">OI</span>
                    <span className="font-mono font-bold text-sm text-foreground">{data.open_interest_total}</span>
                  </div>
                )}
                {data._put_call_ratio != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground uppercase tracking-wide text-[10px]">P/C</span>
                    <span className={`font-mono font-bold text-sm ${data._put_call_ratio > 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {data._put_call_ratio.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Narrative summary */}
            <div className="px-5 py-4">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{data.summary}</p>
            </div>

            {/* MM Positioning block */}
            {data.market_maker_positioning && (
              <div className="mx-5 mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">🏦 MM</span>
                  <div className="h-px flex-1 bg-amber-500/20" />
                  {/* Regime badge derived from GEX sign or price vs gamma */}
                  {data._current_price != null && data.gamma_level != null && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${data._current_price >= data.gamma_level ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-red-500/40 bg-red-500/10 text-red-400'}`}>
                      {data._current_price >= data.gamma_level ? 'LONG GAMMA' : 'SHORT GAMMA'}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-foreground leading-relaxed">{data.market_maker_positioning}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4">
            {/* Gamma Levels */}
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm">🎯 Gamma & Options</CardTitle></CardHeader>
              <CardContent>
                <LevelRow label="Gamma Level" value={data.gamma_level} color="text-primary" />
                <LevelRow label="Call Wall" value={data.call_wall} color="text-emerald-400" />
                <LevelRow label="Put Wall" value={data.put_wall} color="text-red-400" />
                <LevelRow label="Gamma Flip" value={data.gamma_flip} color="text-amber-400" />
                <LevelRow label="Max Pain" value={data.max_pain} color="text-purple-400" />
              </CardContent>
            </Card>

            {/* Pivot Points */}
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-sm">📊 Pivot Points</CardTitle></CardHeader>
              <CardContent>
                {(data.prev_high || data.prev_low || data.prev_close) && (
                  <div className="bg-secondary/40 rounded-lg px-2.5 py-2 mb-3 space-y-0.5">
                    <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Día anterior (base del cálculo)</p>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">High</span>
                      <span className="font-mono text-emerald-400">${data.prev_high?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Low</span>
                      <span className="font-mono text-red-400">${data.prev_low?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Close</span>
                      <span className="font-mono text-foreground">${data.prev_close?.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] border-t border-border/30 pt-1 mt-1">
                      <span className="text-muted-foreground">Fórmula: (H+L+C) / 3</span>
                      <span className="font-mono text-primary">${data.pivot_point?.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                <LevelRow label="R3" value={data.r3} color="text-red-400" />
                <LevelRow label="R2" value={data.r2} color="text-red-400" />
                <LevelRow label="R1" value={data.r1} color="text-orange-400" />
                <LevelRow label="Pivot" value={data.pivot_point} color="text-primary" />
                <LevelRow label="S1" value={data.s1} color="text-cyan-400" />
                <LevelRow label="S2" value={data.s2} color="text-emerald-400" />
                <LevelRow label="S3" value={data.s3} color="text-emerald-400" />
              </CardContent>
            </Card>

            </div>

            {/* Key Strikes */}
            <Card className="bg-card border-border/50 xl:col-span-8">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">🔑 Open Interest y Volumen por Strike</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Leyenda C / P */}
                <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-black text-black">C</span>
                    <div>
                      <p className="text-[11px] font-semibold text-emerald-400">Call Wall {data.call_wall ? `= $${data.call_wall?.toFixed(2)}` : ''}</p>
                      <p className="text-[10px] text-muted-foreground">Strike con MAYOR concentración de OI en Calls. Los MM que vendieron esas calls compran el subyacente al subir → resistencia magnética.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">P</span>
                    <div>
                      <p className="text-[11px] font-semibold text-red-400">Put Wall {data.put_wall ? `= $${data.put_wall?.toFixed(2)}` : ''}</p>
                      <p className="text-[10px] text-muted-foreground">Strike con MAYOR concentración de OI en Puts. Los MM que vendieron esas puts venden el subyacente al caer → soporte magnético que puede amplificar la baja.</p>
                    </div>
                  </div>
                </div>
                {/* Fila de métricas P/C */}
                {(data._put_call_ratio != null || data._total_call_oi != null) && (
                  <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-secondary/30 px-3 py-2 text-[11px]">
                    {data._put_call_ratio != null && (
                      <span className="text-muted-foreground">
                        Ratio P/C: <span className={`font-mono font-bold ${data._put_call_ratio > 1 ? 'text-red-400' : 'text-emerald-400'}`}>{data._put_call_ratio.toFixed(2)}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">{data._put_call_ratio > 1 ? '(sesgo bajista/defensivo)' : '(sesgo alcista)'}</span>
                      </span>
                    )}
                    {data._oi_call_dominant != null && (
                      <span className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${data._oi_call_dominant ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                        {data._oi_call_dominant ? 'OI dominante: CALLS' : 'OI dominante: PUTS'}
                      </span>
                    )}
                    {data._total_call_oi != null && <span className="text-muted-foreground">OI Calls: <span className="font-mono text-emerald-400">{data._total_call_oi.toLocaleString()}</span></span>}
                    {data._total_put_oi != null && <span className="text-muted-foreground">OI Puts: <span className="font-mono text-red-400">{data._total_put_oi.toLocaleString()}</span></span>}
                  </div>
                )}
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={oiViewMode === 'near' ? 'default' : 'outline'}
                    onClick={() => setOiViewMode('near')}
                  >
                    Cercanos al precio
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={oiViewMode === 'structural' ? 'default' : 'outline'}
                    onClick={() => setOiViewMode('structural')}
                  >
                    Estructurales (walls)
                  </Button>
                </div>
                {Array.isArray(oiViewMode === 'near' ? data.key_strikes : data.structural_key_strikes) && (oiViewMode === 'near' ? data.key_strikes : data.structural_key_strikes).length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border/40">
                    <table className="w-full min-w-[420px] text-xs">
                      <thead className="bg-secondary/40">
                        <tr className="text-muted-foreground uppercase tracking-wide text-[10px]">
                          <th className="text-left px-3 py-2">Strike</th>
                          <th className="text-right px-3 py-2">Call OI</th>
                          <th className="text-right px-3 py-2">Put OI</th>
                          <th className="text-right px-3 py-2">OI Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(oiViewMode === 'near' ? data.key_strikes : data.structural_key_strikes).map((ks, idx) => {
                          const isCallWall = data.call_wall != null && Math.abs((ks.strike ?? 0) - data.call_wall) < 0.01;
                          const isPutWall = data.put_wall != null && Math.abs((ks.strike ?? 0) - data.put_wall) < 0.01;
                          return (
                          <tr key={idx} className={`border-t border-border/30 transition-colors ${isCallWall ? 'bg-emerald-500/5 hover:bg-emerald-500/10' : isPutWall ? 'bg-red-500/5 hover:bg-red-500/10' : 'hover:bg-secondary/20'}`}>
                            <td className="px-3 py-2 font-mono font-bold text-sm">
                              <div className="flex items-center gap-1.5">
                                <span>${ks.strike?.toFixed?.(2) ?? ks.strike}</span>
                                {isCallWall && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-black text-black" title="Call Wall — mayor OI en Calls">C</span>}
                                {isPutWall && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white" title="Put Wall — mayor OI en Puts">P</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-400">{(ks.call_oi ?? 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-red-400">{(ks.put_oi ?? 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">{(ks.total_oi ?? 0).toLocaleString()}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Sin desglose de OI/volumen por strike en este análisis.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Análisis del Día + Comentario de los MM */}
          {(data.day_analysis || data.market_maker_comment) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {data.day_analysis && (
                <Card className="bg-card border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span>📅 Análisis del Día</span>
                      <span className="text-[10px] font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-secondary">OI estructural</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {data.call_wall != null && (
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-black">C</span>
                          <span className="font-mono font-bold text-emerald-400">${data.call_wall?.toFixed(2)}</span>
                        </div>
                      )}
                      {data.put_wall != null && (
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-black text-white">P</span>
                          <span className="font-mono font-bold text-red-400">${data.put_wall?.toFixed(2)}</span>
                        </div>
                      )}
                      {data.gamma_level != null && (
                        <span className="text-[11px] text-muted-foreground">
                          Gamma ≈ <span className="font-mono text-amber-400">${data.gamma_level?.toFixed(2)}</span>
                        </span>
                      )}
                      {data.max_pain != null && (
                        <span className="text-[11px] text-muted-foreground">
                          Max Pain <span className="font-mono text-purple-400">${data.max_pain?.toFixed(2)}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{data.day_analysis}</p>
                  </CardContent>
                </Card>
              )}
              {data.market_maker_comment && (
                <Card className="bg-card border-amber-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span>🏦 Comentario de los MM</span>
                      <span className="text-[10px] font-normal text-amber-400 px-2 py-0.5 rounded-full bg-amber-500/10">Market Makers</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{data.market_maker_comment}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Sentiment Institucional — Finviz + TipRanks + Barchart Analysts */}
          {(data.analyst_consensus || data.analyst_price_target || data.institutional_ownership_pct != null || data.smart_score != null) && (            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Analistas */}
              <Card className="bg-card border-border/50">
                <CardHeader className="pb-2"><CardTitle className="text-sm">📊 Consenso de Analistas</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.analyst_consensus && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Consenso</span>
                      <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                        data.analyst_consensus === 'STRONG BUY' ? 'bg-emerald-500/20 text-emerald-400' :
                        data.analyst_consensus === 'BUY' ? 'bg-green-500/20 text-green-400' :
                        data.analyst_consensus === 'HOLD' ? 'bg-amber-500/20 text-amber-400' :
                        data.analyst_consensus === 'SELL' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>{data.analyst_consensus}</span>
                    </div>
                  )}
                  {data.analyst_price_target != null && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Price Target</span>
                      <div className="text-right">
                        <span className="text-sm font-bold font-mono text-primary">${data.analyst_price_target?.toFixed(2)}</span>
                        {data.analyst_upside_pct != null && (
                          <span className={`ml-2 text-[11px] font-semibold ${data.analyst_upside_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {data.analyst_upside_pct >= 0 ? '+' : ''}{data.analyst_upside_pct?.toFixed(1)}% upside
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {data.analysts_count != null && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Analistas que cubren</span>
                      <span className="text-sm font-mono text-foreground">{data.analysts_count}</span>
                    </div>
                  )}
                  {data.earnings_date && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Próx. Earnings</span>
                      <span className="text-sm font-mono text-amber-400">{data.earnings_date}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Smart Score + Flujo Institucional */}
              <Card className="bg-card border-border/50">
                <CardHeader className="pb-2"><CardTitle className="text-sm">🏛️ Flujo Institucional</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.smart_score != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">TipRanks Smart Score</span>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          data.smart_score >= 8 ? 'bg-emerald-500/20 text-emerald-400' :
                          data.smart_score >= 5 ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>{data.smart_score}</div>
                        <span className="text-[10px] text-muted-foreground">/10</span>
                      </div>
                    </div>
                  )}
                  {data.institutional_ownership_pct != null && (
                    <div className="border-t border-border/30 pt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">Propiedad Institucional</span>
                        <span className="text-sm font-mono text-foreground">{data.institutional_ownership_pct?.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(data.institutional_ownership_pct, 100)}%` }} />
                      </div>
                    </div>
                  )}
                  {data.short_float_pct != null && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Short Float</span>
                      <span className={`text-sm font-mono font-bold ${data.short_float_pct > 10 ? 'text-red-400' : data.short_float_pct > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {data.short_float_pct?.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {data.insider_activity && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Insiders</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        data.insider_activity === 'BUYING' ? 'bg-emerald-500/20 text-emerald-400' :
                        data.insider_activity === 'SELLING' ? 'bg-red-500/20 text-red-400' :
                        'bg-secondary text-muted-foreground'
                      }`}>{data.insider_activity}</span>
                    </div>
                  )}
                  {data.hedge_fund_activity && (
                    <div className="flex items-center justify-between border-t border-border/30 pt-2">
                      <span className="text-xs text-muted-foreground">Hedge Funds</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        data.hedge_fund_activity === 'INCREASING' ? 'bg-emerald-500/20 text-emerald-400' :
                        data.hedge_fund_activity === 'DECREASING' ? 'bg-red-500/20 text-red-400' :
                        'bg-secondary text-muted-foreground'
                      }`}>{data.hedge_fund_activity}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}