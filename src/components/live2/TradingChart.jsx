import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CrosshairMode, LineStyle, CandlestickSeries, HistogramSeries } from 'lightweight-charts';

const YAHOO_PROXY = '/api/yahoo';

async function fetchCandles(ticker, interval = '5m', range = '2d') {
  const url = `${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=true`;
  const res = await fetch(url);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const q = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] != null && q.close?.[i] != null) {
      candles.push({
        time: ts[i],
        open: q.open[i],
        high: q.high?.[i] || q.open[i],
        low: q.low?.[i] || q.open[i],
        close: q.close[i],
        volume: q.volume?.[i] || 0,
      });
    }
  }
  return candles;
}

export default function TradingChart({ ticker, levels = {}, signal = null, height = 400 }) {
  const chartRef = useRef(null);
  const containerRef = useRef(null);
  const [lastPrice, setLastPrice] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#888',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1a2e' },
        horzLines: { color: '#1a1a2e' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: '#2a2a3e',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#2a2a3e',
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartRef.current = { chart, candleSeries, volumeSeries };

    // Load data
    fetchCandles(ticker).then(candles => {
      if (!candles.length) return;

      // Color premarket candles differently (darker/muted)
      const coloredCandles = candles.map(c => {
        const d = new Date(c.time * 1000);
        const h = d.getHours();
        const m = d.getMinutes();
        const totalMin = h * 60 + m;
        const isPremarket = totalMin < 570; // Before 9:30
        const isAfterHours = totalMin >= 960; // After 4:00

        if (isPremarket || isAfterHours) {
          return {
            ...c,
            color: c.close >= c.open ? '#1a5c38' : '#5c1a1a',
            borderColor: c.close >= c.open ? '#1a5c38' : '#5c1a1a',
            wickColor: c.close >= c.open ? '#1a5c38' : '#5c1a1a',
          };
        }
        return c;
      });

      candleSeries.setData(coloredCandles);

      const volData = candles.map(c => {
        const d = new Date(c.time * 1000);
        const totalMin = d.getHours() * 60 + d.getMinutes();
        const isExtended = totalMin < 570 || totalMin >= 960;
        return {
          time: c.time,
          value: c.volume,
          color: isExtended
            ? (c.close >= c.open ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)')
            : (c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'),
        };
      });
      volumeSeries.setData(volData);

      setLastPrice(candles[candles.length - 1].close);

      // Draw levels
      const drawLine = (price, color, title, style = LineStyle.Solid, width = 1) => {
        if (!price || !Number.isFinite(price)) return;
        candleSeries.createPriceLine({
          price,
          color,
          lineWidth: width,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        });
      };

      // VWAP
      if (levels.vwap) drawLine(levels.vwap, '#fbbf24', 'VWAP', LineStyle.Dashed, 2);

      // EMA20
      if (levels.ema20) drawLine(levels.ema20, '#60a5fa', 'EMA20', LineStyle.Dotted, 1);

      // PM High/Low
      if (levels.pmHigh) drawLine(levels.pmHigh, '#34d399', 'PM High', LineStyle.Dashed, 1);
      if (levels.pmLow) drawLine(levels.pmLow, '#f87171', 'PM Low', LineStyle.Dashed, 1);

      // Previous Day High/Low
      if (levels.pdh) drawLine(levels.pdh, '#a78bfa', 'PDH', LineStyle.Dotted, 1);
      if (levels.pdl) drawLine(levels.pdl, '#fb923c', 'PDL', LineStyle.Dotted, 1);

      // Morning High/Low (afternoon session)
      if (levels.mh) drawLine(levels.mh, '#06b6d4', 'MH', LineStyle.Dashed, 2);
      if (levels.ml) drawLine(levels.ml, '#f59e0b', 'ML', LineStyle.Dashed, 2);

      // Entry/Stop/Target — active trade or potential zone
      if (signal?.trade && (signal?.phase === 'GO' || signal?.phase === 'ZONE')) {
        const isGo = signal.phase === 'GO';
        const entryStyle = isGo ? LineStyle.Solid : LineStyle.Dashed;
        const entryWidth = isGo ? 2 : 1;
        const entryColor = isGo ? '#ffffff' : 'rgba(255,255,255,0.4)';
        const stopColor = isGo ? '#ef4444' : 'rgba(239,68,68,0.4)';
        const targetColor = isGo ? '#22c55e' : 'rgba(34,197,94,0.4)';

        drawLine(signal.trade.entry, entryColor, isGo ? '→ ENTRY' : '· posible entry', entryStyle, entryWidth);
        drawLine(signal.trade.stop, stopColor, isGo ? '✕ STOP' : '· SL', LineStyle.Dashed, 1);
        drawLine(signal.trade.target_3 || signal.trade.target, targetColor, isGo ? '✓ TARGET' : '· TP', LineStyle.Dashed, 1);
        if (signal.trade.beLevel) drawLine(signal.trade.beLevel, isGo ? '#3b82f6' : 'rgba(59,130,246,0.3)', 'BE', LineStyle.Dotted, 1);
      }

      chart.timeScale().fitContent();
    });

    // Resize handler
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [ticker, levels.vwap, levels.ema20, levels.pmHigh, levels.pmLow, levels.pdh, levels.pdl, levels.mh, levels.ml, signal?.phase]);

  // Auto-refresh candles every 30 seconds
  useEffect(() => {
    if (!chartRef.current) return;
    const interval = setInterval(async () => {
      const candles = await fetchCandles(ticker, '5m', '1d');
      if (candles.length && chartRef.current) {
        chartRef.current.candleSeries.setData(candles);
        const volData = candles.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
        }));
        chartRef.current.volumeSeries.setData(volData);
        setLastPrice(candles[candles.length - 1].close);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [ticker]);

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0a0a0a]">
      <div ref={containerRef} />
    </div>
  );
}
