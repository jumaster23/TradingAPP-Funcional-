// MarketContextProvider.jsx
// Global market context — fetched ONCE, shared across all pages
// VIX, SPY trend, sector breadth, market regime, FOMC calendar

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const YAHOO_PROXY = '/api/yahoo';
const REFRESH_MS = 30_000; // 30 seconds

const MarketContext = createContext(null);

// Helpers
function isMarketOpen() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day > 0 && day < 6 && mins >= 570 && mins < 960;
}

function getETTime() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function getSession() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6) return 'CLOSED';
  if (mins < 240) return 'CLOSED';
  if (mins < 570) return 'PREMARKET';
  if (mins < 630) return 'MORNING_KZ'; // Kill zone 9:30-10:30
  if (mins < 840) return 'MIDDAY';
  if (mins < 930) return 'POWER_HOUR'; // 2:00-3:30
  if (mins < 960) return 'CLOSE';
  if (mins < 1200) return 'AFTERHOURS';
  return 'CLOSED';
}

async function fetchQuote(ticker) {
  try {
    const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=5m&range=1d&includePrePost=true`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const q = result.indicators?.quote?.[0] || {};
    const closes = (q.close || []).filter(v => v != null);
    const volumes = (q.volume || []).filter(v => v != null);
    const price = meta.regularMarketPrice || closes[closes.length - 1];
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const changePct = prevClose ? ((price - prevClose) / prevClose * 100) : 0;
    return { price, prevClose, changePct, volume: volumes.reduce((a, b) => a + b, 0) };
  } catch { return null; }
}

async function fetchDailyEMAs(ticker) {
  try {
    const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=1d&range=1y`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    if (closes.length < 50) return null;

    // Calculate EMAs
    const ema = (arr, period) => {
      const k = 2 / (period + 1);
      const e = [arr[0]];
      for (let i = 1; i < arr.length; i++) e.push(arr[i] * k + e[i - 1] * (1 - k));
      return e[e.length - 1];
    };

    // RSI
    const deltas = closes.slice(-15).map((c, i, a) => i > 0 ? c - a[i - 1] : 0).slice(1);
    const gains = deltas.filter(d => d > 0);
    const losses = deltas.filter(d => d < 0).map(d => Math.abs(d));
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / 14 : 0;
    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    const rsi = +(100 - 100 / (1 + rs)).toFixed(1);

    const sma20 = +(closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(2);
    const sma50 = +(closes.slice(-50).reduce((a, b) => a + b, 0) / 50).toFixed(2);
    const sma200 = closes.length >= 200 ? +(closes.slice(-200).reduce((a, b) => a + b, 0) / 200).toFixed(2) : null;
    const price = closes[closes.length - 1];

    let trend = 'NEUTRAL';
    if (price > sma20 && sma20 > sma50) trend = 'BULLISH';
    else if (price > sma20) trend = 'LEAN_BULLISH';
    else if (price < sma20 && sma20 < sma50) trend = 'BEARISH';
    else if (price < sma20) trend = 'LEAN_BEARISH';

    return { sma20, sma50, sma200, rsi, trend, price };
  } catch { return null; }
}

async function fetchVIX() {
  try {
    const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/^VIX?interval=5m&range=5d`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const current = closes[closes.length - 1];
    const sma10 = +(closes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(closes.length, 10)).toFixed(2);

    let regime = 'NORMAL';
    if (current < 15) regime = 'LOW';
    else if (current < 20) regime = 'NORMAL';
    else if (current < 25) regime = 'ELEVATED';
    else if (current < 30) regime = 'HIGH';
    else regime = 'EXTREME';

    let vixTrend = 'STABLE';
    if (current > sma10 * 1.05) vixTrend = 'RISING';
    else if (current < sma10 * 0.95) vixTrend = 'FALLING';

    return { value: +current.toFixed(2), sma10, regime, trend: vixTrend };
  } catch { return null; }
}

async function fetchBreadth() {
  const sectors = ['XLK', 'XLF', 'XLV', 'XLE', 'XLI', 'XLY', 'XLP', 'XLU', 'XLRE', 'XLC', 'XLB'];
  const names = ['Tech', 'Financials', 'Healthcare', 'Energy', 'Industrials', 'Consumer Disc', 'Consumer Staples', 'Utilities', 'Real Estate', 'Communication', 'Materials'];

  try {
    const results = await Promise.allSettled(
      sectors.map(s => fetchQuote(s))
    );

    let green = 0, red = 0;
    const sectorData = {};

    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        const change = r.value.changePct;
        sectorData[names[i]] = +change.toFixed(2);
        if (change > 0) green++;
        else red++;
      }
    });

    const total = green + red;
    let breadth = 'SELECTIVE';
    if (green >= 8) breadth = 'BROAD_RALLY';
    else if (red >= 8) breadth = 'BROAD_SELL';

    return { sectors: sectorData, green, red, breadth, pct: total > 0 ? Math.round(green / total * 100) : 50 };
  } catch { return null; }
}

// Determine overall market bias
function computeBias(spy, vix, breadth) {
  let bull = 0, bear = 0;

  if (spy?.trend?.includes('BULLISH')) bull++;
  if (spy?.trend?.includes('BEARISH')) bear++;
  if (spy?.rsi > 60) bull++;
  else if (spy?.rsi < 40) bear++;
  if (vix?.value < 18) bull++;
  else if (vix?.value > 25) bear++;
  if (breadth?.green >= 7) bull++;
  else if (breadth?.red >= 7) bear++;

  if (bull >= 3) return 'BULLISH';
  if (bear >= 3) return 'BEARISH';
  if (bull > bear) return 'LEAN_BULLISH';
  if (bear > bull) return 'LEAN_BEARISH';
  return 'NEUTRAL';
}

export function MarketContextProvider({ children }) {
  const [ctx, setCtx] = useState({
    isLoading: true,
    lastUpdate: null,
    marketOpen: false,
    session: 'CLOSED',
    etTime: '',
    bias: 'NEUTRAL',
    spy: null,
    vix: null,
    breadth: null,
    spyEMAs: null,
  });
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    const session = getSession();
    const marketOpen = isMarketOpen();
    const etTime = getETTime();

    const [spyQuote, vix, breadth, spyEMAs] = await Promise.all([
      fetchQuote('SPY'),
      fetchVIX(),
      fetchBreadth(),
      fetchDailyEMAs('SPY'),
    ]);

    const spy = spyQuote ? {
      price: +spyQuote.price.toFixed(2),
      changePct: +spyQuote.changePct.toFixed(2),
      ...(spyEMAs || {}),
    } : null;

    const bias = computeBias(spyEMAs, vix, breadth);

    setCtx({
      isLoading: false,
      lastUpdate: new Date().toISOString(),
      marketOpen,
      session,
      etTime,
      bias,
      spy,
      vix,
      breadth,
      spyEMAs,
    });
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(() => {
      if (isMarketOpen()) refresh();
    }, REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [refresh]);

  return (
    <MarketContext.Provider value={{ ...ctx, refresh }}>
      {children}
    </MarketContext.Provider>
  );
}

export function useMarketContext() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarketContext must be used within MarketContextProvider');
  return ctx;
}

export default MarketContext;
