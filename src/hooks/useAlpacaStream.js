/**
 * useAlpacaStream — connects to Alpaca WebSocket (IEX free feed) for real-time bars.
 * Also calculates: trend (EMA), volatility (ATR), probability score.
 *
 * Returns: { bars, metrics, status, connect, disconnect }
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

// ── Technical calculations ────────────────────────────────────────────────────

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcATR(bars, period = 14) {
  if (bars.length < 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcVolatilityPercent(bars) {
  if (bars.length < 5) return null;
  const recent = bars.slice(-20);
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push((recent[i].c - recent[i - 1].c) / recent[i - 1].c);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100; // % per bar
}

function calcProbability(bars, ema9, ema20, ema50, rsi, atr) {
  if (!bars.length) return 50;
  let score = 50;

  const last = bars[bars.length - 1];
  const price = last.c;

  // Trend alignment (+/- 15)
  if (ema9 && ema20 && ema50) {
    if (ema9 > ema20 && ema20 > ema50 && price > ema9) score += 15; // bullish stack
    else if (ema9 < ema20 && ema20 < ema50 && price < ema9) score -= 15; // bearish stack
    else if (price > ema20) score += 5;
    else score -= 5;
  }

  // RSI zone (+/- 10)
  if (rsi !== null) {
    if (rsi > 50 && rsi < 70) score += 10;
    else if (rsi < 50 && rsi > 30) score -= 10;
    else if (rsi >= 70) score += 5; // overbought — slight reduce
    else if (rsi <= 30) score -= 5; // oversold — slight increase
  }

  // Volume confirmation (+/- 8)
  if (bars.length > 5) {
    const avgVol = bars.slice(-10, -1).reduce((a, b) => a + (b.v || 0), 0) / 9;
    if (last.v > avgVol * 1.2) score += 8;
    else if (last.v < avgVol * 0.5) score -= 5;
  }

  // Candle direction (+/- 7)
  if (last.c > last.o) score += 7;
  else if (last.c < last.o) score -= 7;

  // ATR volatility filter (extreme vol = risky)
  if (atr && price > 0) {
    const atrPct = (atr / price) * 100;
    if (atrPct > 3) score -= 5; // too volatile
    else if (atrPct < 0.2) score -= 3; // too quiet
  }

  return Math.max(5, Math.min(95, Math.round(score)));
}

function computeMetrics(bars) {
  if (bars.length < 3) return null;

  const closes = bars.map(b => b.c);

  const ema9  = calcEMA(closes, 9);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const atr   = calcATR(bars, 14);
  const rsi   = calcRSI(closes, 14);
  const volPct = calcVolatilityPercent(bars);

  const last = bars[bars.length - 1];
  const price = last.c;

  // Trend label
  let trend = 'NEUTRAL';
  if (ema9 && ema20 && ema50) {
    if (ema9 > ema20 && ema20 > ema50) trend = 'BULLISH';
    else if (ema9 < ema20 && ema20 < ema50) trend = 'BEARISH';
  }

  // Volatility label
  let volatility = 'NORMAL';
  if (volPct !== null) {
    if (volPct > 1.5) volatility = 'HIGH';
    else if (volPct < 0.3) volatility = 'LOW';
  }

  const probability = calcProbability(bars, ema9, ema20, ema50, rsi, atr);

  // Volume ratio
  const avgVol = bars.slice(-10, -1).reduce((a, b) => a + (b.v || 0), 0) / Math.max(1, Math.min(9, bars.length - 1));
  const volRatio = avgVol > 0 ? last.v / avgVol : 1;

  return { ema9, ema20, ema50, atr, rsi, volPct, trend, volatility, probability, price, volRatio };
}

// ── Tick candle constructor ───────────────────────────────────────────────────

const DURACION_MS = 60 * 1000; // 1 minuto por vela (ajustable)

function nuevaVela(precio, volumen = 0) {
  return {
    o: precio,
    h: precio,
    l: precio,
    c: precio,
    v: volumen,
    t: Math.floor(Date.now() / 1000),
    _inicio: Date.now(),
  };
}

function actualizarVela(vela, precio, volumen = 0) {
  if (precio > vela.h) vela.h = precio;
  if (precio < vela.l) vela.l = precio;
  vela.c = precio;
  vela.v += volumen;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAlpacaStream() {
  const [bars, setBars] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [liveCandle, setLiveCandle] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | connected | error
  const [currentTicker, setCurrentTicker] = useState(null);
  const wsRef = useRef(null);
  const barsRef = useRef([]);
  const velaActualRef = useRef(null);

  const updateBars = useCallback((newBars) => {
    barsRef.current = newBars;
    setBars([...newBars]);
    setMetrics(computeMetrics(newBars));
  }, []);

  const fetchHistorical = useCallback(async (ticker, timeframe) => {
    setStatus('loading');
    try {
      const res = await base44.functions.invoke('alpacaProxy', {
        action: 'bars',
        ticker,
        timeframe,
        limit: 150,
      });
      const fetchedBars = res?.data?.bars || [];
      updateBars(fetchedBars);
      setStatus('connected');
      return fetchedBars;
    } catch (e) {
      setStatus('error');
      return [];
    }
  }, [updateBars]);

  const connect = useCallback(async (ticker, timeframe = '5Min') => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setCurrentTicker(ticker);
    barsRef.current = [];
    velaActualRef.current = null;
    setBars([]);
    setMetrics(null);
    setLiveCandle(null);

    // Fetch historical bars first
    await fetchHistorical(ticker, timeframe);

    // Connect Alpaca WebSocket (IEX feed — requiere auth)
    try {
      const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
      wsRef.current = ws;

      ws.onopen = () => {
        // Iniciar flujo de autenticación
        const key    = import.meta.env.VITE_ALPACA_API_KEY;
        const secret = import.meta.env.VITE_ALPACA_SECRET_KEY;
        if (key && secret) {
          ws.send(JSON.stringify({ action: 'auth', key, secret }));
        } else {
          // Sin credenciales — suscribir de todas formas (fallará silenciosamente)
          ws.send(JSON.stringify({ action: 'subscribe', trades: [ticker] }));
        }
      };

      ws.onmessage = (e) => {
        try {
          const messages = JSON.parse(e.data);
          messages.forEach(msg => {
            // ── Auth flow ─────────────────────────────────────────────────
            if (msg.T === 'connected') {
              const key    = import.meta.env.VITE_ALPACA_API_KEY;
              const secret = import.meta.env.VITE_ALPACA_SECRET_KEY;
              if (key && secret) {
                ws.send(JSON.stringify({ action: 'auth', key, secret }));
              }
            }
            if (msg.T === 'success' && msg.msg === 'authenticated') {
              ws.send(JSON.stringify({ action: 'subscribe', trades: [ticker] }));
              setStatus('connected');
            }
            if (msg.T === 'error') {
              setStatus('error');
            }

            // ── Tick → Vela propia ────────────────────────────────────────
            if (msg.T === 't' && msg.S === ticker) {
              const precio  = msg.p;            // precio del trade
              const volumen = msg.s || 0;        // tamaño del trade
              const ahora   = Date.now();

              if (!velaActualRef.current) {
                // Primera vela: abrir
                velaActualRef.current = nuevaVela(precio, volumen);
                const { _inicio, ...snapshot } = velaActualRef.current;
                setLiveCandle(snapshot);
              } else if (ahora - velaActualRef.current._inicio >= DURACION_MS) {
                // Tiempo expirado: cerrar vela y empujar al historial
                const { _inicio, ...velaFinal } = velaActualRef.current;
                const currentBars = barsRef.current;
                currentBars.push(velaFinal);
                if (currentBars.length > 300) currentBars.shift();
                // Abrir nueva vela con el tick actual
                velaActualRef.current = nuevaVela(precio, volumen);
                const { _inicio: _newStart, ...snapshotNueva } = velaActualRef.current;
                setLiveCandle(snapshotNueva);
                updateBars([...currentBars]);
              } else {
                // Dentro de la vela: actualizar OHLCV
                actualizarVela(velaActualRef.current, precio, volumen);
                // Snapshot en tiempo real sin afectar historial cerrado
                const { _inicio, ...snapshot } = velaActualRef.current;
                const currentBars = barsRef.current;
                const preview = [...currentBars, snapshot];
                setLiveCandle(snapshot);
                setBars(preview);
                setMetrics(computeMetrics(preview));
              }
            }
          });
        } catch (_) { /* ignore */ }
      };

      ws.onerror = () => setStatus('error');
      ws.onclose = () => {};
    } catch (_) {
      // WebSocket failed silently — historical data still shown
    }
  }, [fetchHistorical, updateBars]);

  const disconnect = useCallback(() => {
    try {
      if (wsRef.current) {
        wsRef.current.close?.();
        wsRef.current = null;
      }
    } catch (_) {}
    setStatus('idle');
    setLiveCandle(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        disconnect();
      } catch (_) {}
    };
  }, [disconnect]);

  return { bars, metrics, liveCandle, status, currentTicker, connect, disconnect };
}