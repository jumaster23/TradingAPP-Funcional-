import React, { useState } from 'react';
import TickerInput from '../components/trading/TickerInput';
import SignalBadge from '../components/trading/SignalBadge';
import GapAnalysis from '../components/probabilities/GapAnalysis';
import ORBCard from '../components/probabilities/ORBCard';
import BacktestModal from '../components/trading/BacktestModal';
import TradeLevels from '../components/trading/TradeLevels';
import ProbabilityBar from '../components/trading/ProbabilityBar';
import { useProbabilityAnalysis } from '../hooks/useProbabilityAnalysis';
import { Database, Wifi, Wind } from 'lucide-react';
import VixPanel from '../components/probabilities/VixPanel';
import LivePriceBadge from '../components/trading/LivePriceBadge';
import LiveVixBadge from '../components/trading/LiveVixBadge';
import ChartErrorBoundary from '../components/daytrading/ChartErrorBoundary';
import ConsensusPanel from '../components/trading/ConsensusPanel';

export default function Probabilities() {
  const { ticker, setTicker, isLoading, loadingStage, analysisResult, lastUpdated, analyze, saveAnalysis } = useProbabilityAnalysis();
  const [showBacktest, setShowBacktest] = useState(false);
  const runAnalysis = () => {
    analyze();
  };

  return (
    <div className="space-y-6">
      <TickerInput
        ticker={ticker}
        setTicker={setTicker}
        onAnalyze={runAnalysis}
        onRefresh={runAnalysis}
        onSave={saveAnalysis}
        onBacktest={() => setShowBacktest(true)}
        isLoading={isLoading}
        lastUpdated={lastUpdated}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center space-y-4">
            <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            <p className="text-sm font-medium text-foreground">{loadingStage || `Analizando ${ticker}...`}</p>
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Database className="w-3 h-3 text-primary" />
                Probabilidades históricas (DB)
              </span>
              <span className="flex items-center gap-1.5">
                <Wifi className="w-3 h-3 text-amber-400" />
                Datos en tiempo real
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Live Price — shown as soon as ticker is set, auto-refreshes every 5s */}
      {ticker && <LivePriceBadge ticker={ticker} intervalMs={5000} />}

      {/* Live VIX — always visible, refreshes every 10s */}
      {ticker && <LiveVixBadge />}

      {analysisResult && !isLoading && (
        <ChartErrorBoundary resetKey={ticker + String(!!analysisResult)}>
        <div className="space-y-6">
          {/* Signal & Summary */}
          <div className="flex flex-wrap items-center gap-4 p-4 bg-card rounded-xl border border-border/50">
            <SignalBadge signal={analysisResult.signal} size="lg" />
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm text-muted-foreground">{analysisResult.analysis_summary}</p>
            </div>
            <ProbabilityBar label="Probabilidad de Éxito" successPercent={analysisResult.success_probability || 50} className="w-full md:w-64" />
          </div>

          <ConsensusPanel
            title="Consenso Probabilístico"
            consensus={analysisResult.window_consensus}
            setupGrade={analysisResult.setup_grade}
            entryAlert={analysisResult.entry_alert}
          />

          {/* Data source legend */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
            <span className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-primary" />
              Barras de probabilidad = datos históricos en DB
            </span>
            <span className="flex items-center gap-1.5">
              <Wifi className="w-3 h-3 text-amber-400" />
              Precios y rangos = tiempo real
            </span>
          </div>

          {/* Trade Levels */}
          <div className="p-4 bg-card rounded-xl border border-border/50 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Niveles de Operación</h3>
            <TradeLevels entry={analysisResult.entry_price} stopLoss={analysisResult.stop_loss} takeProfit={analysisResult.take_profit} direction={analysisResult.signal} />

            {/* VIX Warning inline */}
            {analysisResult.vix_warning && (
              <div className={`mt-3 p-3 rounded-lg border text-xs font-medium ${
                analysisResult.vix_prob_penalty <= -20
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : analysisResult.vix_prob_penalty <= -10
                  ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                  : analysisResult.vix_prob_penalty < 0
                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}>
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Análisis en tiempo real</p>
                <p>{analysisResult.vix_warning}</p>
              </div>
            )}

            {/* R:R display */}
            {analysisResult.entry_price && analysisResult.stop_loss && analysisResult.take_profit && (
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground mt-2">
                <span>Riesgo: <span className="text-red-400 font-mono font-bold">${Math.abs(analysisResult.entry_price - analysisResult.stop_loss).toFixed(2)}</span></span>
                <span>Beneficio: <span className="text-emerald-400 font-mono font-bold">${Math.abs(analysisResult.take_profit - analysisResult.entry_price).toFixed(2)}</span></span>
                <span>R:R: <span className="text-foreground font-mono font-bold">1:{(Math.abs(analysisResult.take_profit - analysisResult.entry_price) / Math.abs(analysisResult.entry_price - analysisResult.stop_loss)).toFixed(1)}</span></span>
                {analysisResult.vix_min_rr > 1.5 && (
                  <span className="text-amber-400">(mín. requerido: 1:{analysisResult.vix_min_rr})</span>
                )}
              </div>
            )}
          </div>

          {/* VIX Panel */}
          <VixPanel
            vix={analysisResult.vix_level}
            regime={analysisResult.vix_regime}
            change={analysisResult.vix_change}
            changePct={analysisResult.vix_change_pct}
            impact={analysisResult.vix_impact}
          />


          {/* Gap */}
          <GapAnalysis data={analysisResult.gap_analysis} />

          {/* Index Confluence Panel */}
          {analysisResult.index_confluence && (
            <div className="p-4 bg-card rounded-xl border border-border/50 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Wind className="w-4 h-4 text-primary" />
                Confluencia de Índices
              </h3>
              <p className={`text-xs font-medium px-2 py-1 rounded-md inline-block ${
                analysisResult.index_confluence.aligned && analysisResult.index_confluence.market_direction === 'bullish'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : analysisResult.index_confluence.aligned && analysisResult.index_confluence.market_direction === 'bearish'
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-amber-500/15 text-amber-400'
              }`}>
                {analysisResult.index_confluence.direction_label}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {analysisResult.index_confluence.spy && (
                  <div className="bg-secondary/40 rounded-lg p-2.5 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold text-muted-foreground">SPY (S&P 500)</span>
                      <span className={`text-[10px] font-bold ${analysisResult.index_confluence.spy.direction === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {analysisResult.index_confluence.spy.direction === 'bullish' ? '▲' : '▼'} {analysisResult.index_confluence.spy.change_pct}%
                      </span>
                    </div>
                    <span className="text-sm font-mono font-bold text-foreground">${analysisResult.index_confluence.spy.price?.toFixed(2)}</span>
                  </div>
                )}
                {analysisResult.index_confluence.qqq && (
                  <div className="bg-secondary/40 rounded-lg p-2.5 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-semibold text-muted-foreground">QQQ (Nasdaq 100)</span>
                      <span className={`text-[10px] font-bold ${analysisResult.index_confluence.qqq.direction === 'bullish' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {analysisResult.index_confluence.qqq.direction === 'bullish' ? '▲' : '▼'} {analysisResult.index_confluence.qqq.change_pct}%
                      </span>
                    </div>
                    <span className="text-sm font-mono font-bold text-foreground">${analysisResult.index_confluence.qqq.price?.toFixed(2)}</span>
                  </div>
                )}
              </div>
              {analysisResult.vix_level && (
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground">VIX:</span>
                  <span className={`font-bold font-mono ${
                    analysisResult.vix_level < 15 ? 'text-emerald-400' :
                    analysisResult.vix_level < 20 ? 'text-foreground' :
                    analysisResult.vix_level < 25 ? 'text-amber-400' : 'text-red-400'
                  }`}>{analysisResult.vix_level?.toFixed(2)}</span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-muted-foreground">Confluencia boost:</span>
                  <span className={`font-bold ${analysisResult.index_confluence.confluence_boost > 0 ? 'text-emerald-400' : analysisResult.index_confluence.confluence_boost < 0 ? 'text-red-400' : 'text-foreground'}`}>
                    {analysisResult.index_confluence.confluence_boost > 0 ? '+' : ''}{analysisResult.index_confluence.confluence_boost}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ORBs */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Opening Range Breakout (ORB)</h3>
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
              <Database className="w-3 h-3 text-primary" />
              Probabilidades de ruptura basadas en datos históricos · Rangos ORB en tiempo real (Yahoo Finance)
            </p>
            {analysisResult.orb_stats_meta && (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${analysisResult.orb_stats_meta.stale || analysisResult.orb_stats_meta.warning ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
                <p>
                  ORB histórico: fuente {analysisResult.orb_stats_meta.source} · edad {analysisResult.orb_stats_meta.age_days ?? 'N/A'} días · TTL {analysisResult.orb_stats_meta.ttl_days} días.
                </p>
                {analysisResult.orb_stats_meta.warning && (
                  <p className="mt-1 text-amber-200">{analysisResult.orb_stats_meta.warning}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ORBCard timeframe="5 min" data={analysisResult.orb_5min} gapData={analysisResult.gap_analysis} confluence={analysisResult.index_confluence} />
              <ORBCard timeframe="15 min" data={analysisResult.orb_15min} gapData={analysisResult.gap_analysis} confluence={analysisResult.index_confluence} />
              <ORBCard timeframe="30 min" data={analysisResult.orb_30min} gapData={analysisResult.gap_analysis} confluence={analysisResult.index_confluence} />
              <ORBCard timeframe="1 hora" data={analysisResult.orb_1h} gapData={analysisResult.gap_analysis} confluence={analysisResult.index_confluence} />
            </div>
          </div>

        </div>
        </ChartErrorBoundary>
      )}

      <BacktestModal
        open={showBacktest}
        onClose={() => setShowBacktest(false)}
        data={analysisResult?.backtesting}
        title={`${ticker} Probabilidades`}
      />
    </div>
  );
}