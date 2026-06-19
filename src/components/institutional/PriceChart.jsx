import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  CandlestickSeries, LineSeries, HistogramSeries,
} from 'lightweight-charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle } from 'lucide-react';

const YAHOO_PROXY = '/api/yahoo';

const INTERVALS = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '1d', label: '1D' },
];

const RANGES = [
  { value: '1d', label: '1D' },
  { value: '5d', label: '5D' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '1y', label: '1Y' },
];

// ── Fetch OHLCV from Yahoo Finance ──────────────────────────────────────────

async function fetchOHLCV(ticker, interval, range) {
  const res = await fetch(
    `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const result = data?.chart?.result?.[0];

  if (!result) throw new Error('Sin datos para este ticker');

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const meta = result.meta || {};

  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    candles.push({
      time: timestamps[i],
      open: +q.open[i].toFixed(2),
      high: +q.high[i].toFixed(2),
      low: +q.low[i].toFixed(2),
      close: +q.close[i].toFixed(2),
      volume: q.volume?.[i] || 0,
    });
  }

  if (!candles.length) throw new Error('No se encontraron velas válidas');

  return {
    candles,
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName || '',
    price: meta.regularMarketPrice || candles[candles.length - 1]?.close,
    prevClose: meta.chartPreviousClose,
  };
}

// ── EMA calculation ─────────────────────────────────────────────────────────

function calcEMA(candles, period) {
  const k = 2 / (period + 1);
  const emaData = [];
  let prev = null;

  for (const c of candles) {
    if (prev === null) {
      prev = c.close;
    } else {
      prev = c.close * k + prev * (1 - k);
    }
    emaData.push({ time: c.time, value: +prev.toFixed(2) });
  }

  return emaData;
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtVolume(v) {
  if (!v) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toString();
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PriceChart({
  ticker,
  interval = '1h',
  range = '1mo',
  height = 400,
  callWall,
  putWall,
  gammaFlip,
  maxPain,
  entry,
  stopLoss,
  takeProfit,
  ema20 = true,
  ema50 = true,
  showVolume = true,
}) {
  const [ohlcv, setOhlcv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeInterval, setActiveInterval] = useState(interval);
  const [activeRange, setActiveRange] = useState(range);
  const [crosshairData, setCrosshairData] = useState(null);

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);

  // ── Fetch data ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOHLCV(ticker, activeInterval, activeRange);
        if (!cancelled) setOhlcv(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [ticker, activeInterval, activeRange]);

  // ── Chart lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!ohlcv || !chartContainerRef.current) return;

    const { candles } = ohlcv;
    const container = chartContainerRef.current;

    // Create chart
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#888',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1a2e' },
        horzLines: { color: '#1a1a2e' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#555', width: 1, style: LineStyle.Dashed },
        horzLine: { color: '#555', width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: '#2a2a3e',
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.25 : 0.05 },
      },
      timeScale: {
        borderColor: '#2a2a3e',
        timeVisible: activeInterval !== '1d',
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });

    chartRef.current = chart;

    // Candlestick series (v5 API: addSeries)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeries.setData(candles);

    // Volume histogram (v5 API: addSeries)
    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? '#10b98140' : '#ef444440',
        }))
      );
    }

    // EMA overlays
    if (ema20 && candles.length >= 20) {
      const ema20Series = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        title: 'EMA 20',
      });
      ema20Series.setData(calcEMA(candles, 20));
    }

    if (ema50 && candles.length >= 50) {
      const ema50Series = chart.addSeries(LineSeries, {
        color: '#6366f1',
        lineWidth: 1,
        title: 'EMA 50',
      });
      ema50Series.setData(calcEMA(candles, 50));
    }

    // Institutional level price lines
    const levels = [
      { price: callWall, title: 'Call Wall', color: '#10b981', lineStyle: LineStyle.Dashed, lineWidth: 2 },
      { price: putWall, title: 'Put Wall', color: '#ef4444', lineStyle: LineStyle.Dashed, lineWidth: 2 },
      { price: gammaFlip, title: 'Gamma Flip', color: '#f59e0b', lineStyle: LineStyle.Dotted, lineWidth: 2 },
      { price: maxPain, title: 'Max Pain', color: '#a855f7', lineStyle: LineStyle.Dotted, lineWidth: 1 },
      { price: entry, title: 'Entry', color: '#38bdf8', lineStyle: LineStyle.Solid, lineWidth: 2 },
      { price: stopLoss, title: 'Stop Loss', color: '#ef4444', lineStyle: LineStyle.Solid, lineWidth: 2 },
      { price: takeProfit, title: 'Take Profit', color: '#10b981', lineStyle: LineStyle.Solid, lineWidth: 2 },
    ];

    levels.forEach(({ price, title, color, lineStyle: ls, lineWidth: lw }) => {
      if (price != null) {
        candleSeries.createPriceLine({
          price,
          color,
          lineWidth: lw,
          lineStyle: ls,
          axisLabelVisible: true,
          title,
        });
      }
    });

    // Crosshair move → OHLCV tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setCrosshairData(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries);
      if (bar) {
        setCrosshairData({
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        });
      }
    });

    // Fit content
    chart.timeScale().fitContent();

    // Resize observer
    const observer = new ResizeObserver(() => {
      if (container) {
        chart.applyOptions({ width: container.clientWidth });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [
    ohlcv, height, showVolume, ema20, ema50, activeInterval,
    callWall, putWall, gammaFlip, maxPain, entry, stopLoss, takeProfit,
  ]);

  // ── Derived values ──────────────────────────────────────────────────────

  const priceChange = ohlcv
    ? ohlcv.price - (ohlcv.prevClose || ohlcv.candles[0]?.open || 0)
    : 0;
  const priceChangePct = ohlcv?.prevClose
    ? (priceChange / ohlcv.prevClose) * 100
    : 0;
  const isPositive = priceChange >= 0;

  // Current OHLCV bar (crosshair or last candle)
  const displayBar = crosshairData || (ohlcv?.candles?.length
    ? ohlcv.candles[ohlcv.candles.length - 1]
    : null);

  // Active institutional levels for legend
  const activeLevels = [
    callWall != null && { color: '#10b981', label: 'Call Wall', value: callWall },
    putWall != null && { color: '#ef4444', label: 'Put Wall', value: putWall },
    gammaFlip != null && { color: '#f59e0b', label: 'Gamma Flip', value: gammaFlip },
    maxPain != null && { color: '#a855f7', label: 'Max Pain', value: maxPain },
    entry != null && { color: '#38bdf8', label: 'Entry', value: entry },
    stopLoss != null && { color: '#ef4444', label: 'Stop Loss', value: stopLoss },
    takeProfit != null && { color: '#10b981', label: 'Take Profit', value: takeProfit },
  ].filter(Boolean);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Card className="border-white/10 bg-[#0a0a0a]">
      <CardHeader className="pb-2">
        {/* Header row: ticker + price */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg font-bold text-white">
              {ticker}
            </CardTitle>
            {ohlcv && (
              <>
                <span className="font-mono text-lg text-white font-semibold">
                  ${fmt(ohlcv.price)}
                </span>
                <span
                  className={`font-mono text-sm font-medium ${
                    isPositive ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {isPositive ? '+' : ''}
                  {fmt(priceChange)} ({isPositive ? '+' : ''}
                  {fmt(priceChangePct)}%)
                </span>
                {ohlcv.exchange && (
                  <span className="text-xs text-white/40">{ohlcv.exchange}</span>
                )}
              </>
            )}
          </div>

          {/* Interval + Range selectors */}
          <div className="flex items-center gap-1">
            {INTERVALS.map((iv) => (
              <Button
                key={iv.value}
                variant={activeInterval === iv.value ? 'default' : 'ghost'}
                size="sm"
                className={`h-6 px-2 text-xs ${
                  activeInterval === iv.value
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                onClick={() => setActiveInterval(iv.value)}
              >
                {iv.label}
              </Button>
            ))}
            <span className="mx-1 text-white/20">|</span>
            {RANGES.map((r) => (
              <Button
                key={r.value}
                variant={activeRange === r.value ? 'default' : 'ghost'}
                size="sm"
                className={`h-6 px-2 text-xs ${
                  activeRange === r.value
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
                onClick={() => setActiveRange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {/* OHLCV bar + EMA legend */}
        {displayBar && (
          <div className="flex items-center gap-3 mt-1 text-xs font-mono flex-wrap">
            <span className="text-white/60">
              O:<span className="text-white">{fmt(displayBar.open)}</span>
            </span>
            <span className="text-white/60">
              H:<span className="text-white">{fmt(displayBar.high)}</span>
            </span>
            <span className="text-white/60">
              L:<span className="text-white">{fmt(displayBar.low)}</span>
            </span>
            <span className="text-white/60">
              C:
              <span
                className={
                  displayBar.close >= displayBar.open
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }
              >
                {fmt(displayBar.close)}
              </span>
            </span>
            {displayBar.volume != null && (
              <span className="text-white/60">
                V:<span className="text-white">{fmtVolume(displayBar.volume)}</span>
              </span>
            )}
            <span className="mx-1" />
            {ema20 && (
              <span className="text-amber-400/80">EMA 20</span>
            )}
            {ema50 && (
              <span className="text-indigo-400/80">EMA 50</span>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {/* Loading state */}
        {loading && (
          <div
            className="flex items-center justify-center bg-[#0a0a0a]"
            style={{ height }}
          >
            <Loader2 className="h-8 w-8 animate-spin text-white/30" />
            <span className="ml-2 text-sm text-white/40">
              Cargando datos...
            </span>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div
            className="flex flex-col items-center justify-center gap-2 bg-[#0a0a0a]"
            style={{ height }}
          >
            <AlertTriangle className="h-8 w-8 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/50 hover:text-white"
              onClick={() => {
                setError(null);
                setLoading(true);
                fetchOHLCV(ticker, activeInterval, activeRange)
                  .then(setOhlcv)
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false));
              }}
            >
              Reintentar
            </Button>
          </div>
        )}

        {/* Chart container */}
        {!loading && !error && (
          <div ref={chartContainerRef} className="w-full" />
        )}

        {/* Institutional levels legend */}
        {activeLevels.length > 0 && !loading && (
          <div className="flex items-center gap-4 px-4 py-2 flex-wrap border-t border-white/5">
            {activeLevels.map((level) => (
              <div
                key={level.label}
                className="flex items-center gap-1.5 text-xs"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: level.color }}
                />
                <span className="text-white/50">{level.label}</span>
                <span className="font-mono text-white/70">
                  ${fmt(level.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
