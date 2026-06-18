// Trading Coach — Real-time narrative of what's happening and what to do
// Generates messages based on market state, signals, levels, convergence

export function generateCoachMessages({ ticker, price, dayAnalysis, convergence, signal, pmBreakout, pmLevels, rejection, orderFlow, livePrice, scanResult }) {
  const messages = [];
  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // 0. SESSION
  const session = signal?.session;
  if (session) {
    if (session.name === 'OPENING') {
      messages.push({ time: now, type: 'context', icon: '🔔', text: 'SESIÓN DE APERTURA (9:30-10:30). Mejores trades del día. Usar niveles PDH/PDL/PMH/PML. Esperar breakout o rechazo con convergencia NQ+SPX.' });
    } else if (session.name === 'MIDDAY') {
      messages.push({ time: now, type: 'warning', icon: '⏸️', text: 'MEDIODÍA (10:30-2:00). Zona de chop. Ser muy selectivo o esperar la tarde.' });
    } else if (session.name === 'AFTERNOON') {
      messages.push({ time: now, type: 'context', icon: '🔔', text: 'SESIÓN DE TARDE (2:00-4:00). Nuevos niveles: Morning High (MH) y Morning Low (ML) activos. Buscar breakout del rango de la mañana con convergencia.' });
    } else if (session.name === 'PREMARKET') {
      messages.push({ time: now, type: 'info', icon: '🌅', text: 'PREMARKET. Marcando niveles PMH/PML. Preparar plan para la apertura.' });
    } else if (session.name === 'CLOSED') {
      messages.push({ time: now, type: 'neutral', icon: '🌙', text: 'MERCADO CERRADO. Revisar trades del día en TradeHistory.' });
    }
  }

  // 1. MARKET CONTEXT
  if (dayAnalysis) {
    if (dayAnalysis.quality === 'EXCELENTE' || dayAnalysis.quality === 'BUENO') {
      messages.push({
        time: now,
        type: 'context',
        icon: '📊',
        text: `Día ${dayAnalysis.quality}. VIX ${dayAnalysis.vix} ${dayAnalysis.vixTrend?.toLowerCase() || ''}, SPY ${dayAnalysis.spyTrend}, ${dayAnalysis.breadth}/6 tickers alineados. Podemos buscar ${dayAnalysis.maxTrades} trades hoy.`,
      });
    } else if (dayAnalysis.quality === 'DIFÍCIL') {
      messages.push({
        time: now,
        type: 'warning',
        icon: '⚠️',
        text: `Día DIFÍCIL. ${dayAnalysis.negatives?.[0] || 'Condiciones mixtas'}. Si tradeas, solo el MEJOR setup y reduce tamaño.`,
      });
    } else {
      messages.push({
        time: now,
        type: 'danger',
        icon: '🚫',
        text: `HOY NO SE TRADEA. ${dayAnalysis.negatives?.join('. ') || 'Sin condiciones'}. Mejor esperar mañana.`,
      });
    }
  }

  // 2. CONVERGENCE STATUS
  if (convergence) {
    if (convergence.converging) {
      messages.push({
        time: now,
        type: 'good',
        icon: '🟢',
        text: `Convergencia activa. ${convergence.reason}. Mercado alineado para buscar entradas.`,
      });
    } else if (convergence.strength === 'PARCIAL') {
      messages.push({
        time: now,
        type: 'neutral',
        icon: '🟡',
        text: `Convergencia parcial. ${convergence.reason}. Esperar que ambos confirmen.`,
      });
    } else {
      messages.push({
        time: now,
        type: 'warning',
        icon: '🔴',
        text: `Sin convergencia. ${convergence.reason}. No buscar entradas ahora.`,
      });
    }
  }

  // 3. ORDER FLOW
  if (orderFlow && !orderFlow.error) {
    if (orderFlow.absorption) {
      messages.push({
        time: now,
        type: 'alert',
        icon: '🔮',
        text: `Absorción detectada en ${ticker}. Volumen alto con poco movimiento — institucionales posicionándose. Movimiento fuerte viene.`,
      });
    }

    if (orderFlow.pressure === 'COMPRADORES DOMINAN' || orderFlow.pressure === 'VENDEDORES DOMINAN') {
      messages.push({
        time: now,
        type: 'info',
        icon: '📈',
        text: `${ticker}: ${orderFlow.pressure}. Flujo ${orderFlow.buyPct5}% compra últimos 5min. ${orderFlow.flowTrend}.`,
      });
    }
  }

  // 4. LEVEL PROXIMITY — approaching key levels
  const p = livePrice || price || 0;

  if (pmLevels && p > 0) {
    if (!pmLevels.brokeHigh && pmLevels.distToHigh > 0 && pmLevels.distToHigh < 1.5) {
      const stopDist = p < 250 ? 1 : p < 400 ? 1.5 : p < 550 ? 2 : 2.5;
      messages.push({
        time: now,
        type: 'alert',
        icon: '🎯',
        text: `${ticker} acercándose al PM High $${pmLevels.pmHigh} ($${pmLevels.distToHigh} de distancia). Si rompe con volumen y NQ+SPX → CALL. Si rechaza con wick → CALL desde rebote. SL $${(p - stopDist).toFixed(2)}, TP $${(p + stopDist * 3).toFixed(2)}.`,
      });
    }
    if (!pmLevels.brokeLow && pmLevels.distToLow > 0 && pmLevels.distToLow < 1.5) {
      const stopDist = p < 250 ? 1 : p < 400 ? 1.5 : p < 550 ? 2 : 2.5;
      messages.push({
        time: now,
        type: 'alert',
        icon: '🎯',
        text: `${ticker} acercándose al PM Low $${pmLevels.pmLow} ($${pmLevels.distToLow} de distancia). Si rompe abajo con NQ+SPX bajando → PUT. Si rebota con wick → CALL. SL $${(p + stopDist).toFixed(2)}, TP $${(p - stopDist * 3).toFixed(2)}.`,
      });
    }
    if (pmLevels.brokeHigh) {
      messages.push({
        time: now,
        type: 'info',
        icon: '📈',
        text: `${ticker} rompió PM High $${pmLevels.pmHigh}. Si tiene volumen y convergencia → buscar CALL en pullback al nivel.`,
      });
    }
  }

  // 5. REJECTION DETECTED
  if (rejection?.signal !== 'NONE' && rejection?.rejection) {
    const r = rejection.rejection;
    messages.push({
      time: now,
      type: 'go',
      icon: '🟢',
      text: `¡RECHAZO en ${r.level} $${r.levelPrice}! ${r.reason}. ${r.direction} $${rejection.trade.entry}. SL $${rejection.trade.stop}. TP $${rejection.trade.target}. BE en $${rejection.trade.beLevel}.`,
    });
  }

  // 6. PM BREAKOUT
  if (pmBreakout?.phase === 'GO' && pmBreakout?.breakout) {
    const b = pmBreakout.breakout;
    messages.push({
      time: now,
      type: 'go',
      icon: '🟢',
      text: `¡PM BREAKOUT! ${pmBreakout.signal} $${b.entry}. Rompió ${pmBreakout.signal === 'CALL' ? 'PM High' : 'PM Low'} con volumen y convergencia. SL $${b.stop}. TP $${b.target}. BE en $${b.beLevel}.`,
    });
  } else if (pmBreakout?.phase === 'ZONE' && pmBreakout?.breakout) {
    const b = pmBreakout.breakout;
    messages.push({
      time: now,
      type: 'alert',
      icon: '🟡',
      text: `PM Breakout detectado pero falta GO. ${b.missing?.join('. ') || 'Esperando confirmación'}. Entrada posible en $${b.entry}.`,
    });
  }

  // 7. SMART ENTRY
  if (signal?.phase === 'GO' && signal?.trade && !pmBreakout?.breakout && rejection?.signal === 'NONE') {
    messages.push({
      time: now,
      type: 'go',
      icon: '🟢',
      text: `¡ENTRAR! ${signal.signal} ${ticker} $${signal.trade.entry}. EMA+VWAP+Convergencia confirman. SL $${signal.trade.stop}. TP $${signal.trade.target_3}. BE en $${signal.trade.beLevel}. Si sube a $${signal.trade.beLevel} mueve stop a breakeven.`,
    });
  } else if (signal?.phase === 'ZONE' && signal?.trade && !pmBreakout?.breakout && rejection?.signal === 'NONE') {
    messages.push({
      time: now,
      type: 'alert',
      icon: '🟡',
      text: `Zona de entrada ${signal.signal} en $${signal.trade.entry}. ${signal.goTrigger?.missing?.map(m => m).join('. ') || 'Esperando GO'}. Cuando confirme → SL $${signal.trade.stop}, TP $${signal.trade.target_3}.`,
    });
  }

  // 8. NO SIGNAL EXPLANATION
  if (!signal?.trade && !pmBreakout?.breakout && rejection?.signal === 'NONE') {
    const reasons = [];
    if (signal?.filters?.chop?.isChop) reasons.push('mercado en rango (chop)');
    if (signal?.filters?.emaFilter?.allowed === 'NEUTRAL') reasons.push('EMA sin dirección');
    if (convergence && !convergence.converging) reasons.push('sin convergencia NQ+SPX');
    if (signal?.filters?.hours?.period === 'LUNCH_DEAD') reasons.push('hora muerta (mediodía)');
    if (signal?.filters?.hours?.period === 'CLOSED') reasons.push('mercado cerrado');

    if (reasons.length) {
      messages.push({
        time: now,
        type: 'neutral',
        icon: '⏸️',
        text: `Sin setup para ${ticker} ahora. ${reasons.join(', ')}. Esperando que las condiciones se alineen.`,
      });
    }
  }

  // 9. VWAP/EMA20 context
  if (orderFlow && !orderFlow.error && p > 0) {
    const vDist = Math.abs(p - orderFlow.vwap);
    const eDist = Math.abs(p - orderFlow.ema20);
    if (vDist < 0.5) {
      messages.push({
        time: now,
        type: 'info',
        icon: '📍',
        text: `${ticker} está justo en VWAP $${orderFlow.vwap}. Nivel de decisión. Arriba = compradores, abajo = vendedores.`,
      });
    }
    if (eDist < 0.5) {
      messages.push({
        time: now,
        type: 'info',
        icon: '📍',
        text: `${ticker} está justo en EMA20 $${orderFlow.ema20}. Soporte/resistencia dinámica.`,
      });
    }
  }

  // 10. SCANNER RECOMMENDATION
  if (scanResult?.entries?.length > 0) {
    const best = scanResult.entries[0];
    if (best.ticker !== ticker && best.phase === 'GO') {
      messages.push({
        time: now,
        type: 'alert',
        icon: '💡',
        text: `${best.ticker} tiene mejor setup que ${ticker}. ${best.signal} con ${best.confidence}% confianza. Considera cambiar.`,
      });
    } else if (best.ticker !== ticker && best.phase === 'ZONE') {
      messages.push({
        time: now,
        type: 'info',
        icon: '👀',
        text: `${best.ticker} tiene zona de entrada ${best.signal} (${best.confidence}%). Vigilar.`,
      });
    }

    const goCount = scanResult.entries.filter(e => e.phase === 'GO').length;
    const zoneCount = scanResult.entries.filter(e => e.phase === 'ZONE').length;
    if (goCount > 0) {
      const goTickers = scanResult.entries.filter(e => e.phase === 'GO').map(e => `${e.ticker} ${e.signal}`).join(', ');
      messages.push({
        time: now,
        type: 'good',
        icon: '🎯',
        text: `${goCount} ticker${goCount > 1 ? 's' : ''} con GO activo: ${goTickers}. Toma los 2 mejores.`,
      });
    } else if (zoneCount > 0) {
      messages.push({
        time: now,
        type: 'neutral',
        icon: '⏳',
        text: `${zoneCount} ticker${zoneCount > 1 ? 's' : ''} en zona. Esperando que confirmen con volumen y convergencia.`,
      });
    }
  }

  return messages;
}
