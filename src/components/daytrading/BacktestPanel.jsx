import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, BarChart3, Zap } from 'lucide-react';
import { runSmartBacktest, runMultiBacktest } from '@/lib/smartBacktest';

const TICKERS = ['SPY', 'QQQ', 'NVDA', 'AMD', 'AAPL', 'MSFT', 'META', 'TSLA', 'GOOGL', 'AMZN'];

function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

function formatPrice(p) {
  return p != null ? `$${Number(p).toFixed(2)}` : '--';
}

function formatPct(p) {
  if (p == null) return '--';
  const sign = p > 0 ? '+' : '';
  return `${sign}${Number(p).toFixed(2)}%`;
}

async function fetchMultiTimeframeData(ticker, range = '5d') {
  const intervals = ['1m', '5m', '15m', '1h'];
  const results = {};
  
  await Promise.all(intervals.map(async (interval) => {
    try {
      const res = await fetch(`/api/yahoo/chart/${ticker}?interval=${interval}&range=${range}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      results[interval] = result;
    } catch (e) {
      results[interval] = null;
    }
  }));
  
  return results;
}

function calculateEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < 2 || !lows || lows.length < 2 || !closes || closes.length < 2) return null;
  
  const trs = [];
  for (let i = 1; i < Math.min(highs.length, lows.length, closes.length); i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    trs.push(tr);
  }
  
  if (trs.length === 0) return null;
  if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
  
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function getTrendFromEMAs(ema9, ema20, ema50, price) {
  if (ema9 == null || ema20 == null) return 'NEUTRAL';
  
  if (ema9 > ema20 && ema20 >= ema50 && price > ema9) return 'BULLISH';
  if (ema9 < ema20 && ema20 <= ema50 && price < ema9) return 'BEARISH';
  if (price > ema9) return 'BULLISH';
  if (price < ema9) return 'BEARISH';
  
  return 'NEUTRAL';
}

async function runBacktest(ticker, marketData, days) {
  const rangeMap = { '7': '7d', '14': '5d', '30': '5d', '60': '1mo', '90': '1mo' };
  const range = rangeMap[days] || '5d';
  
  const tickerData = await fetchMultiTimeframeData(ticker, range);
  const spyData = marketData.SPY ? await fetchMultiTimeframeData('SPY', range) : null;
  const qqqData = marketData.QQQ ? await fetchMultiTimeframeData('QQQ', range) : null;
  
  const data1m = tickerData['1m'];
  if (!data1m || !data1m.timestamp) {
    throw new Error('No se encontraron datos para ' + ticker);
  }
  
  const quote1m = data1m.indicators?.quote?.[0] || {};
  const timestamps = data1m.timestamp || [];
  const closes1m = (quote1m.close || []).filter(v => v != null);
  const highs1m = (quote1m.high || []).filter(v => v != null);
  const lows1m = (quote1m.low || []).filter(v => v != null);
  
  const spy1m = spyData?.['1m'];
  const spyQuote = spy1m?.indicators?.quote?.[0] || {};
  const spyCloses = (spyQuote.close || []).filter(v => v != null);
  const spyHighs = (spyQuote.high || []).filter(v => v != null);
  const spyLows = (spyQuote.low || []).filter(v => v != null);
  
  const qqq1m = qqqData?.['1m'];
  const qqqQuote = qqq1m?.indicators?.quote?.[0] || {};
  const qqqCloses = (qqqQuote.close || []).filter(v => v != null);
  const qqqHighs = (qqqQuote.high || []).filter(v => v != null);
  const qqqLows = (qqqQuote.low || []).filter(v => v != null);
  
  const trades = [];
  const warmup = 50;
  const lookahead = 20;
  const rangeLookback = 20;
  
  for (let i = warmup; i < closes1m.length - lookahead; i++) {
    const price = closes1m[i];
    const high = highs1m[i];
    const low = lows1m[i];
    
    if (price == null || high == null || low == null) continue;
    
    // Market must be AT extreme of recent range
    const spyHigh = Math.max(...spyHighs.slice(Math.max(0, i - rangeLookback), i + 1));
    const spyLow = Math.min(...spyLows.slice(Math.max(0, i - rangeLookback), i + 1));
    const qqqHigh = Math.max(...qqqHighs.slice(Math.max(0, i - rangeLookback), i + 1));
    const qqqLow = Math.min(...qqqLows.slice(Math.max(0, i - rangeLookback), i + 1));
    
    const spyAtHigh = spyCloses[i] >= spyHigh * 0.98;
    const spyAtLow = spyCloses[i] <= spyLow * 1.02;
    const qqqAtHigh = qqqCloses[i] >= qqqHigh * 0.98;
    const qqqAtLow = qqqCloses[i] <= qqqLow * 1.02;
    
    // Both must agree on direction AND be at extreme
    if (!((spyAtHigh && qqqAtHigh) || (spyAtLow && qqqAtLow))) continue;
    
    const marketDirection = spyAtHigh && qqqAtHigh ? 'BULLISH' : 'BEARISH';
    
    // Ticker must also be at extreme of its range
    const tickerHigh = Math.max(...highs1m.slice(Math.max(0, i - rangeLookback), i + 1));
    const tickerLow = Math.min(...lows1m.slice(Math.max(0, i - rangeLookback), i + 1));
    const tickerAtHigh = price >= tickerHigh * 0.98;
    const tickerAtLow = price <= tickerLow * 1.02;
    
    if (!((tickerAtHigh && marketDirection === 'BULLISH') || (tickerAtLow && marketDirection === 'BEARISH'))) continue;
    
    // ATR check - need some volatility
    const atr = calculateATR(
      highs1m.slice(Math.max(0, i - 14), i + 1),
      lows1m.slice(Math.max(0, i - 14), i + 1),
      closes1m.slice(Math.max(0, i - 14), i + 1),
      14
    );
    if (!atr || (atr / price) * 100 < 0.1) continue;
    
    const isCall = marketDirection === 'BULLISH';
    const sl = isCall ? tickerLow : tickerHigh;
    const tp = isCall ? price + atr * 1 : price - atr * 1; // 1:1 R:R
    
    let result = 'TIMEOUT';
    let exitPrice = closes1m[Math.min(i + lookahead, closes1m.length - 1)];
    let pnlPct = 0;
    let barsToHit = 0;
    
    for (let j = 1; j <= lookahead && i + j < closes1m.length; j++) {
      const futureHigh = highs1m[i + j];
      const futureLow = lows1m[i + j];
      barsToHit = j;
      
      if (isCall) {
        if (futureHigh >= tp) {
          result = 'WIN';
          exitPrice = tp;
          pnlPct = ((tp - price) / price) * 100;
          break;
        }
        if (futureLow <= sl) {
          result = 'LOSS';
          exitPrice = sl;
          pnlPct = ((sl - price) / price) * 100;
          break;
        }
      } else {
        if (futureLow <= tp) {
          result = 'WIN';
          exitPrice = tp;
          pnlPct = ((price - tp) / price) * 100;
          break;
        }
        if (futureHigh >= sl) {
          result = 'LOSS';
          exitPrice = sl;
          pnlPct = ((price - sl) / price) * 100;
          break;
        }
      }
    }
    
    if (result === 'TIMEOUT') {
      exitPrice = closes1m[Math.min(i + lookahead, closes1m.length - 1)];
      pnlPct = isCall ? ((exitPrice - price) / price) * 100 : ((price - exitPrice) / price) * 100;
      result = pnlPct >= 0 ? 'WIN' : 'LOSS';
    }
    
    trades.push({
      date: new Date(timestamps[i] * 1000).toLocaleDateString(),
      signal: isCall ? 'CALL' : 'PUT',
      entry: price,
      sl,
      tp,
      exitPrice,
      pnlPct,
      result,
      marketDir: marketDirection,
      atr: atr?.toFixed(2),
      barsToHit
    });
  }
  
  return { trades, ticker, range, barsAnalyzed: closes1m.length - warmup - lookahead };
}

function StatsGrid({ stats }) {
  const cards = [
    { label: 'Total Trades', value: stats.total, color: '' },
    { label: 'Win Rate', value: stats.winRate + '%', color: stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Profit Factor', value: stats.profitFactor, color: stats.profitFactor >= 1.5 ? 'text-emerald-400' : stats.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Avg PnL', value: (stats.avgPnl > 0 ? '+' : '') + stats.avgPnl.toFixed(2) + '%', color: stats.avgPnl > 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Wins', value: stats.wins, color: 'text-emerald-400' },
    { label: 'Losses', value: stats.losses, color: 'text-red-400' },
    { label: 'Avg Win', value: '+' + stats.avgWin.toFixed(2) + '%', color: 'text-emerald-400' },
    { label: 'Avg Loss', value: stats.avgLoss.toFixed(2) + '%', color: 'text-red-400' },
  ];
  
  return (
    <div className="grid grid-cols-4 gap-2">
      {cards.map((card) => (
        <div key={card.label} className="bg-secondary/40 rounded-lg p-3 text-center">
          <p className="text-[9px] text-muted-foreground uppercase">{card.label}</p>
          <p className={cn("text-xl font-bold", card.color)}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}

function TradesTable({ trades }) {
  if (!trades || trades.length === 0) return null;
  
  return (
    <div className="bg-secondary/30 rounded-lg border border-border/40 overflow-hidden">
      <div className="p-3 border-b border-border/40">
        <p className="text-[10px] text-muted-foreground uppercase">Detalle de Trades</p>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead className="bg-secondary/50 sticky top-0">
            <tr className="text-muted-foreground">
              <th className="text-left p-2">Fecha</th>
              <th className="text-center p-2">Signal</th>
              <th className="text-right p-2">Entry</th>
              <th className="text-right p-2">SL</th>
              <th className="text-right p-2">TP</th>
              <th className="text-right p-2">Exit</th>
              <th className="text-right p-2">PnL</th>
              <th className="text-center p-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 100).map((trade, i) => (
              <tr key={i} className={cn(
                "border-b border-border/20",
                trade.result === 'WIN' && "bg-emerald-500/10",
                trade.result === 'LOSS' && "bg-red-500/10"
              )}>
                <td className="p-2 text-muted-foreground">{trade.date}</td>
                <td className={cn("p-2 text-center font-bold", trade.signal === 'CALL' ? 'text-emerald-400' : 'text-red-400')}>
                  {trade.signal}
                </td>
                <td className="p-2 text-right font-mono">{formatPrice(trade.entry)}</td>
                <td className="p-2 text-right font-mono text-red-400">{formatPrice(trade.sl)}</td>
                <td className="p-2 text-right font-mono text-emerald-400">{formatPrice(trade.tp)}</td>
                <td className="p-2 text-right font-mono">{formatPrice(trade.exitPrice)}</td>
                <td className={cn("p-2 text-right font-mono font-bold", trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%
                </td>
                <td className={cn("p-2 text-center font-bold", trade.result === 'WIN' ? 'text-emerald-400' : trade.result === 'LOSS' ? 'text-red-400' : 'text-amber-400')}>
                  {trade.result}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length > 100 && (
          <p className="text-center py-2 text-muted-foreground text-[9px]">
            ... y {trades.length - 100} trades más
          </p>
        )}
      </div>
    </div>
  );
}

function SmartTradesTable({ trades }) {
  if (!trades || trades.length === 0) return null;

  return (
    <div className="bg-secondary/30 rounded-lg border border-border/40 overflow-hidden">
      <div className="p-3 border-b border-border/40">
        <p className="text-[10px] text-muted-foreground uppercase">Detalle de Trades — Entrada Inteligente</p>
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-[10px]">
          <thead className="bg-secondary/50 sticky top-0">
            <tr className="text-muted-foreground">
              <th className="text-left p-2">Fecha</th>
              <th className="text-center p-2">Hora</th>
              <th className="text-center p-2">Ticker</th>
              <th className="text-center p-2">Señal</th>
              <th className="text-center p-2">Setup</th>
              <th className="text-right p-2">Entry</th>
              <th className="text-right p-2">SL</th>
              <th className="text-right p-2">TP</th>
              <th className="text-right p-2">Exit</th>
              <th className="text-right p-2">PnL</th>
              <th className="text-center p-2">R:R</th>
              <th className="text-center p-2">Tipo</th>
              <th className="text-left p-2">Razones</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i} className={cn(
                "border-b border-border/20",
                t.result === 'WIN' && "bg-emerald-500/10",
                t.result === 'LOSS' && "bg-red-500/10"
              )}>
                <td className="p-2 text-muted-foreground">{t.date}</td>
                <td className="p-2 text-center font-mono">{t.time}</td>
                <td className="p-2 text-center font-bold">{t.ticker || ''}</td>
                <td className={cn("p-2 text-center font-bold", t.signal === 'CALL' ? 'text-emerald-400' : 'text-red-400')}>
                  {t.signal}
                </td>
                <td className={cn("p-2 text-center font-bold",
                  t.setup === 'A+' ? 'text-green-400' : t.setup === 'A' ? 'text-emerald-400' : 'text-yellow-400'
                )}>{t.setup}</td>
                <td className="p-2 text-right font-mono">{formatPrice(t.entry)}</td>
                <td className="p-2 text-right font-mono text-red-400">{formatPrice(t.sl)}</td>
                <td className="p-2 text-right font-mono text-emerald-400">{formatPrice(t.tp)}</td>
                <td className="p-2 text-right font-mono">{formatPrice(t.exitPrice)}</td>
                <td className={cn("p-2 text-right font-mono font-bold", t.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct}%
                </td>
                <td className="p-2 text-center font-mono">{t.rr}</td>
                <td className={cn("p-2 text-center text-[9px]",
                  t.exitType === 'TARGET' ? 'text-emerald-400' : t.exitType === 'STOP' ? 'text-red-400' : 'text-amber-400'
                )}>{t.exitType}</td>
                <td className="p-2 text-[9px] text-muted-foreground max-w-[200px] truncate">{t.reasons}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BacktestPanel() {
  const [ticker, setTicker] = useState('SPY');
  const [days, setDays] = useState('14');
  const [includeMarket, setIncludeMarket] = useState({ SPY: true, QQQ: true });
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('smart'); // 'smart' or 'classic'
  const [smartResults, setSmartResults] = useState(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState(null);

  // Date range — defaults to last 5 days
  const today = new Date().toISOString().split('T')[0];
  const thirtyAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const fiveAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(fiveAgo);
  const [endDate, setEndDate] = useState(today);

  const handleSmartBacktest = async () => {
    setSmartLoading(true);
    setSmartError(null);
    setSmartResults(null);
    try {
      if (ticker === 'ALL') {
        const res = await runMultiBacktest(['NVDA', 'META', 'QQQ', 'AMD', 'AMZN', 'GOOGL'], null, startDate, endDate);
        setSmartResults({ multi: true, ...res });
      } else {
        const res = await runSmartBacktest(ticker, null, startDate, endDate);
        setSmartResults(res);
      }
    } catch (e) {
      setSmartError(e.message || 'Error en Smart Backtest');
    } finally {
      setSmartLoading(false);
    }
  };

  const handleRunBacktest = async () => {
    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const backtestResults = await runBacktest(ticker, includeMarket, days);
      setResults(backtestResults);
    } catch (e) {
      setError(e.message || 'Error en el backtest');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (trades) => {
    if (!trades || trades.length === 0) return null;
    
    const wins = trades.filter(t => t.result === 'WIN');
    const losses = trades.filter(t => t.result === 'LOSS');
    const totalTrades = trades.length;
    const winRate = (wins.length / totalTrades) * 100;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length) : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
    const totalPnl = trades.reduce((s, t) => s + t.pnlPct, 0);
    const avgPnl = totalPnl / totalTrades;
    
    return {
      total: totalTrades,
      wins: wins.length,
      losses: losses.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      avgPnl,
      totalPnl
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Backtest
        </p>
        <div className="flex gap-1">
          <button onClick={() => setMode('smart')} className={cn("text-[10px] px-3 py-1 rounded-full", mode === 'smart' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
            <Zap className="w-3 h-3 inline mr-1" />Entrada Inteligente
          </button>
          <button onClick={() => setMode('classic')} className={cn("text-[10px] px-3 py-1 rounded-full", mode === 'classic' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>
            Clásico
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[100px]">
          <label className="text-[10px] text-muted-foreground block mb-1">Ticker {mode === 'smart' && '(o ALL para todos)'}</label>
          <Input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            className="bg-secondary border-border font-mono"
            placeholder={mode === 'smart' ? 'NVDA o ALL' : 'SPY'}
          />
        </div>

        {mode === 'smart' ? (
          <>
            <div className="w-36">
              <label className="text-[10px] text-muted-foreground block mb-1">Desde</label>
              <input
                type="date"
                value={startDate}
                min={thirtyAgo}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="w-36">
              <label className="text-[10px] text-muted-foreground block mb-1">Hasta</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={today}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </>
        ) : (
          <div className="w-24">
            <label className="text-[10px] text-muted-foreground block mb-1">Rango</label>
            <select
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full bg-secondary border border-border rounded px-2 py-1.5 text-sm"
            >
              <option value="7">5 días</option>
              <option value="14">5 días</option>
              <option value="30">1 mes</option>
              <option value="60">1 mes</option>
              <option value="90">3 meses</option>
            </select>
          </div>
        )}

        <Button onClick={mode === 'smart' ? handleSmartBacktest : handleRunBacktest} disabled={isLoading || smartLoading} className="h-9">
          {(isLoading || smartLoading) ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ejecutar'}
        </Button>
      </div>

      {/* Quick date presets for smart mode */}
      {mode === 'smart' && (
        <div className="flex gap-2 text-[10px]">
          {[
            { label: 'Hoy', s: today, e: today },
            { label: 'Últ. 5 días', s: fiveAgo, e: today },
            { label: 'Últ. 2 semanas', s: new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0], e: today },
            { label: 'Últ. 30 días', s: thirtyAgo, e: today },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => { setStartDate(p.s); setEndDate(p.e); }}
              className={cn("px-2 py-1 rounded", startDate === p.s && endDate === p.e ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80')}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Smart Entry Backtest Results */}
      {mode === 'smart' && smartError && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 text-red-400 text-sm">{smartError}</div>
      )}

      {mode === 'smart' && smartResults && (
        <>
          <div className="bg-card rounded-lg p-4 border border-border/40">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
              <Zap className="w-3 h-3" />
              Entrada Inteligente — {smartResults.multi ? 'Todos los tickers' : smartResults.ticker} • {startDate} a {endDate} • {smartResults.multi ? smartResults.combined?.total : smartResults.stats?.total} trades
            </p>
            <StatsGrid stats={smartResults.multi ? smartResults.combined : smartResults.stats} />
          </div>

          {/* Per-ticker breakdown for multi */}
          {smartResults.multi && smartResults.results?.map((r, idx) => (
            r.stats?.total > 0 && (
              <div key={idx} className="bg-secondary/30 rounded-lg p-3 border border-border/20">
                <p className="text-[10px] font-bold text-muted-foreground mb-2">{r.ticker}</p>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <div>Trades: {r.stats.total}</div>
                  <div className={r.stats.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>WR: {r.stats.winRate}%</div>
                  <div className={r.stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>PnL: {r.stats.totalPnl > 0 ? '+' : ''}{r.stats.totalPnl}%</div>
                  <div>PF: {r.stats.profitFactor}</div>
                </div>
              </div>
            )
          ))}

          <SmartTradesTable trades={smartResults.multi ? smartResults.allTrades : smartResults.trades} />

          {!smartResults.trades?.length && !smartResults.allTrades?.length && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Sin trades encontrados. La estrategia no encontró setups con suficiente confirmación.
            </div>
          )}
        </>
      )}

      {mode === 'smart' && !smartResults && !smartError && !smartLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg mb-2">Backtest — Entrada Inteligente</p>
          <p className="text-sm">Filtros: EMA10, VWAP reclaim, chop detection, SPY convergencia, stops estructurales</p>
          <p className="text-xs mt-2 opacity-60">Escribe ALL para testear todos los tickers juntos</p>
        </div>
      )}

      {mode === 'classic' && <div className="flex gap-4 text-[10px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMarket.SPY}
            onChange={(e) => setIncludeMarket(prev => ({ ...prev, SPY: e.target.checked }))}
            className="rounded"
          />
          <span className="text-muted-foreground">Incluir SPY como dirección del mercado</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={includeMarket.QQQ}
            onChange={(e) => setIncludeMarket(prev => ({ ...prev, QQQ: e.target.checked }))}
            className="rounded"
          />
          <span className="text-muted-foreground">Incluir QQQ como dirección del mercado</span>
        </label>
      </div>}

      {mode === 'classic' && error && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {mode === 'classic' && results && (
        <>
          <div className="bg-card rounded-lg p-4 border border-border/40">
            <p className="text-xs text-muted-foreground mb-3">
              Backtest de {results.ticker} • {results.barsAnalyzed} barras analizadas
            </p>
            <StatsGrid stats={calculateStats(results.trades)} />
          </div>
          
          <TradesTable trades={results.trades} />
        </>
      )}

      {mode === 'classic' && !results && !error && !isLoading && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-lg mb-2">Backtesting — Estrategia Breakout</p>
          <p className="text-sm">Ejecuta el backtest para ver resultados</p>
          <p className="text-xs mt-2 opacity-60">
            Lógica: Cuando SPY y QQQ están en HIGH/LOW del rango y el ticker también — entrada en dirección del mercado
          </p>
          <p className="text-[10px] mt-1 opacity-40">
            Win rate objetivo: 80%+
          </p>
        </div>
      )}
    </div>
  );
}