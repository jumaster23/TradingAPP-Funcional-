import React, { useState, useCallback, useMemo } from 'react';
import { useMarketContext } from '@/lib/MarketContextProvider';
import { fullOptionsReport } from '@/lib/optionsAnalytics';

// Charts
import GEXChart from '@/components/institutional/GEXChart';
import OIDistributionChart from '@/components/institutional/OIDistributionChart';
import IVTermStructureChart from '@/components/institutional/IVTermStructureChart';
import IVSkewChart from '@/components/institutional/IVSkewChart';
import MaxPainChart from '@/components/institutional/MaxPainChart';
import FlowScoreCard from '@/components/institutional/FlowScoreCard';
import DashboardScore from '@/components/institutional/DashboardScore';
import TradePlan from '@/components/institutional/TradePlan';
import AlertPack from '@/components/institutional/AlertPack';
import PriceChart from '@/components/institutional/PriceChart';

// UI
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Search, Loader2, Building2, TrendingUp, TrendingDown,
  Shield, Target, Activity, AlertTriangle, BarChart3, Clock,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(v, decimals = 2) {
  if (v == null) return '—';
  return Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(v) {
  if (v == null) return '—';
  const n = Number(v);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function pctRaw(v) {
  if (v == null) return '—';
  const n = Number(v);
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function scoreContracts(calls, spot) {
  if (!calls?.length || !spot) return [];

  const lower = spot * 0.95;
  const upper = spot * 1.05;
  const nearby = calls.filter(c => c.strike >= lower && c.strike <= upper);

  return nearby.map(c => {
    const iv = c.impliedVolatility ?? 0;
    const oi = c.openInterest ?? 0;
    const bid = c.bid ?? 0;
    const ask = c.ask ?? 0;
    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    const spreadPct = mid > 0 ? spread / mid : 1;

    // Approximate delta from moneyness (fallback — Yahoo doesn't always provide greeks)
    const T = 30 / 365;
    const d1 = Math.log(spot / c.strike) / (iv * Math.sqrt(T) || 1) + 0.5 * iv * Math.sqrt(T);
    const approxDelta = 0.5 + 0.5 * Math.tanh(d1 * 1.2);

    // Score: closer to 0.50 delta = better, higher OI = better, lower spread = better
    const deltaScore = Math.max(0, 30 - Math.abs(approxDelta - 0.50) * 60);
    const oiScore = Math.min(30, Math.log10(Math.max(oi, 1)) * 6);
    const spreadScore = Math.max(0, 20 - spreadPct * 100);
    const ivScore = iv > 0 ? Math.min(20, 20 - Math.abs(iv - 0.30) * 40) : 0;
    const total = deltaScore + oiScore + spreadScore + ivScore;

    return {
      contract: `${c.strike}C`,
      strike: c.strike,
      ask: ask,
      delta: approxDelta,
      oi,
      iv,
      spread,
      type: 'CALL',
      score: Math.round(total),
    };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ─── Header Stat Box ────────────────────────────────────────────────────────

function StatBox({ label, value, sub, icon: Icon, color = 'text-cyan-400' }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 py-2 min-w-[110px]">
      {Icon && <Icon className={`w-3.5 h-3.5 ${color} mb-0.5`} />}
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
        {label}
      </span>
      <span className={`text-sm font-bold font-mono ${color}`}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

// ─── Preferred Contracts Table ──────────────────────────────────────────────

function PreferredContractsTable({ contracts }) {
  if (!contracts?.length) {
    return (
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            Contratos Preferidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Sin contratos cercanos ATM disponibles.</p>
        </CardContent>
      </Card>
    );
  }

  const best = contracts[0];

  return (
    <Card className="bg-card border-border/50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-amber-500/60 via-orange-500/40 to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-amber-400" />
          Contratos Preferidos
          <span className="text-[10px] text-muted-foreground ml-auto">±5 strikes ATM</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-1.5 text-muted-foreground font-medium"></th>
                <th className="text-left py-1.5 text-muted-foreground font-medium">Contrato</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">Ask</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">Delta</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">OI</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">IV</th>
                <th className="text-center py-1.5 text-muted-foreground font-medium">Tipo</th>
                <th className="text-right py-1.5 text-muted-foreground font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c, i) => {
                const isBest = c === best;
                return (
                  <tr
                    key={c.contract}
                    className={`border-b border-border/10 ${isBest ? 'bg-amber-500/5' : ''}`}
                  >
                    <td className="py-1.5 text-center">
                      {isBest ? <span className="text-amber-400 text-sm">★</span> : ''}
                    </td>
                    <td className="py-1.5 font-mono font-bold text-foreground">
                      {c.contract}
                    </td>
                    <td className="py-1.5 text-right font-mono text-foreground">
                      ${fmt(c.ask)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-cyan-400">
                      {c.delta.toFixed(2)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-foreground">
                      {c.oi.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-mono text-purple-400">
                      {pct(c.iv)}
                    </td>
                    <td className="py-1.5 text-center">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        {c.type}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono font-bold text-amber-400">
                      {c.score}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function InstitutionalPro() {
  const [ticker, setTicker] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const market = useMarketContext();

  const analyze = useCallback(async () => {
    if (!ticker) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fullOptionsReport(ticker.toUpperCase());
      setReport(result);
      setLastUpdated(new Date());
      toast.success(`Análisis de ${ticker.toUpperCase()} completado`);
    } catch (err) {
      setError(err.message);
      toast.error('Error: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [ticker]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') analyze();
  };

  // Derived data
  const derived = useMemo(() => {
    if (!report) return null;

    const { gex, oiDistribution, ivTermStructure, ivSkew, maxPain, flow, spot, expDays } = report;

    const gexRegime = gex?.totalGEX > 0 ? 'POSITIVE' : gex?.totalGEX < 0 ? 'NEGATIVE' : 'NEUTRAL';
    const ivAtm = ivTermStructure?.data?.[0]?.atmIV ?? null;
    const changePct = market?.spy?.changePct ?? null;

    // Top call/put strikes by OI
    const oiData = oiDistribution?.data ?? [];
    const topCallStrikes = [...oiData]
      .sort((a, b) => (b.callOI ?? 0) - (a.callOI ?? 0))
      .slice(0, 3)
      .map(d => d.strike);
    const topPutStrikes = [...oiData]
      .sort((a, b) => (b.putOI ?? 0) - (a.putOI ?? 0))
      .slice(0, 3)
      .map(d => d.strike);

    // Score components for DashboardScore
    const distToCallWall = oiDistribution?.callWall && spot
      ? ((oiDistribution.callWall - spot) / spot * 100).toFixed(2)
      : null;
    const distToPutWall = oiDistribution?.putWall && spot
      ? ((spot - oiDistribution.putWall) / spot * 100).toFixed(2)
      : null;
    const maxPainAlignment = maxPain?.maxPainStrike && spot
      ? Math.abs(maxPain.maxPainStrike - spot) / spot < 0.02
        ? 'ALIGNED'
        : maxPain.maxPainStrike > spot
          ? 'ABOVE'
          : 'BELOW'
      : null;

    // Bias from flow tilt
    const flowBias = flow?.tilt === 'bullish'
      ? 'ALCISTA'
      : flow?.tilt === 'bearish'
        ? 'BAJISTA'
        : 'NEUTRAL';

    // Score status
    const computeConviction = () => {
      let s = 50;
      if (gexRegime === 'POSITIVE') s += 10;
      if (flow?.score > 60) s += 10;
      else if (flow?.score < 40) s -= 10;
      if (ivTermStructure?.structure === 'contango') s += 5;
      if (oiDistribution?.pcr < 0.7) s += 5;
      else if (oiDistribution?.pcr > 1.3) s -= 5;
      if (market?.vix?.value < 18) s += 5;
      else if (market?.vix?.value > 25) s -= 10;
      if (ivSkew?.skew25d != null && ivSkew.skew25d < 0.02) s += 5;
      return Math.max(0, Math.min(100, s));
    };

    const conviction = computeConviction();
    const setupStatus = conviction >= 70
      ? 'Long Active'
      : conviction >= 50
        ? 'Long Watchlist'
        : 'Short Watchlist';

    return {
      gexRegime,
      ivAtm,
      changePct,
      topCallStrikes,
      topPutStrikes,
      distToCallWall,
      distToPutWall,
      maxPainAlignment,
      flowBias,
      conviction,
      setupStatus,
    };
  }, [report, market]);

  const preferredContracts = useMemo(() => {
    if (!report?.spot) return [];
    // Use raw chain calls — fullOptionsReport doesn't store raw chain,
    // but we can reconstruct from oiDistribution data + flow unusual activity
    // Actually the chain calls are in the flow calculation. Let's score from OI distribution.
    // We need the actual call objects — let's re-derive from what we have.
    // Since fullOptionsReport doesn't expose raw calls, we build from OI dist data
    const oiData = report.oiDistribution?.data ?? [];
    const spot = report.spot;
    if (!oiData.length) return [];

    // Build pseudo-contracts from OI distribution + IV skew data
    const ivData = report.ivSkew?.data ?? [];
    const ivMap = new Map();
    for (const d of ivData) {
      if (d.callIV != null) ivMap.set(d.strike, d.callIV);
    }

    const pseudoCalls = oiData
      .filter(d => d.callOI > 0)
      .map(d => ({
        strike: d.strike,
        openInterest: d.callOI,
        impliedVolatility: ivMap.get(d.strike) ?? 0.25,
        bid: 0,
        ask: 0,
      }));

    return scoreContracts(pseudoCalls, spot);
  }, [report]);

  // ─── Render States ──────────────────────────────────────────────────────────

  // Empty state
  if (!report && !isLoading && !error) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <HeaderInput
            ticker={ticker}
            setTicker={setTicker}
            onAnalyze={analyze}
            onKeyDown={handleKeyDown}
            isLoading={isLoading}
          />
          <div className="flex items-center justify-center min-h-[60vh]">
            <Card className="bg-card border-border/50 max-w-lg w-full">
              <CardContent className="p-8 text-center space-y-4">
                <Building2 className="w-16 h-16 text-cyan-500/30 mx-auto" />
                <h2 className="text-xl font-bold text-foreground">
                  Panel Institucional de Opciones
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Ingresa un ticker para obtener análisis completo de opciones con datos reales de Yahoo Finance.
                  GEX, OI, IV Surface, Max Pain, Flow Score — todo calculado en tiempo real.
                </p>
                <div className="flex flex-wrap gap-2 justify-center pt-2">
                  {['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'META'].map(t => (
                    <Button
                      key={t}
                      variant="outline"
                      size="sm"
                      className="text-xs font-mono"
                      onClick={() => { setTicker(t); }}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* ─── Ticker Input ──────────────────────────────────────────────── */}
        <HeaderInput
          ticker={ticker}
          setTicker={setTicker}
          onAnalyze={analyze}
          onKeyDown={handleKeyDown}
          isLoading={isLoading}
          lastUpdated={lastUpdated}
        />

        {/* ─── Loading ───────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <Loader2 className="w-10 h-10 text-cyan-500 animate-spin" />
            <p className="text-sm text-muted-foreground animate-pulse">
              Cargando análisis institucional de <span className="text-cyan-400 font-mono font-bold">{ticker.toUpperCase()}</span>...
            </p>
            <p className="text-[10px] text-muted-foreground/50">
              IV Term Structure requiere múltiples solicitudes — puede tomar 10-15 segundos
            </p>
          </div>
        )}

        {/* ─── Error ─────────────────────────────────────────────────────── */}
        {error && !isLoading && (
          <Card className="bg-red-500/5 border-red-500/30">
            <CardContent className="p-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-400">Error en análisis</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs"
                  onClick={analyze}
                >
                  Reintentar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Dashboard ─────────────────────────────────────────────────── */}
        {report && !isLoading && derived && (
          <>
            {/* ── A. Header Bar ──────────────────────────────────────────── */}
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-3 sticky top-0 z-30">
              <div className="flex flex-wrap items-center justify-center gap-1 md:gap-0">
                {/* Title */}
                <div className="flex flex-col items-center px-4 py-2 min-w-[160px] border-r border-border/20">
                  <span className="text-xs font-bold text-cyan-400 font-mono tracking-wider">
                    {report.ticker}
                  </span>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/60 font-medium">
                    Institutional Options Dashboard
                  </span>
                </div>

                <StatBox
                  label="Spot Price"
                  value={`$${fmt(report.spot)}`}
                  sub={derived.changePct != null ? pctRaw(derived.changePct) : undefined}
                  icon={Activity}
                  color={
                    derived.changePct > 0
                      ? 'text-emerald-400'
                      : derived.changePct < 0
                        ? 'text-red-400'
                        : 'text-foreground'
                  }
                />

                <StatBox
                  label="IV ATM"
                  value={derived.ivAtm != null ? pct(derived.ivAtm) : '—'}
                  icon={BarChart3}
                  color="text-purple-400"
                />

                <StatBox
                  label="Max Pain (Est.)"
                  value={report.maxPain?.maxPainStrike ? `$${fmt(report.maxPain.maxPainStrike)}` : '—'}
                  icon={Target}
                  color="text-amber-400"
                />

                <StatBox
                  label="Call Wall"
                  value={report.oiDistribution?.callWall ? `$${fmt(report.oiDistribution.callWall)}` : '—'}
                  icon={TrendingUp}
                  color="text-emerald-400"
                />

                <StatBox
                  label="Put Wall"
                  value={report.oiDistribution?.putWall ? `$${fmt(report.oiDistribution.putWall)}` : '—'}
                  icon={TrendingDown}
                  color="text-red-400"
                />

                <StatBox
                  label="DTE"
                  value={`${report.expDays}d`}
                  sub={report.expDate}
                  icon={Clock}
                  color="text-sky-400"
                />
              </div>
            </div>

            {/* ── Price Chart ─────────────────────────────────────────── */}
            <PriceChart
              ticker={report.ticker || ticker.toUpperCase()}
              interval="1h"
              range="1mo"
              height={420}
              callWall={report.oiDistribution?.callWall}
              putWall={report.oiDistribution?.putWall}
              gammaFlip={report.gex?.gammaFlip}
              maxPain={report.maxPain?.maxPainStrike}
            />

            {/* ── B. Main Grid ───────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* ── Left Column ───────────────────────────────────────────── */}
              <div className="space-y-4">

                {/* Executive Summary */}
                <Card className="bg-card border-border/50 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500/60 via-blue-500/40 to-transparent" />
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-cyan-400" />
                      Resumen Ejecutivo
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <SummaryItem
                        label="SETUP"
                        value={derived.setupStatus}
                        color={
                          derived.setupStatus === 'Long Active'
                            ? 'text-emerald-400'
                            : derived.setupStatus === 'Short Watchlist'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                      <SummaryItem
                        label="CONVICCIÓN"
                        value={`${derived.conviction}/100`}
                        color={
                          derived.conviction >= 70
                            ? 'text-emerald-400'
                            : derived.conviction >= 50
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }
                      />
                      <SummaryItem
                        label="FASE DE MERCADO"
                        value={market?.bias ?? 'N/A'}
                        color={
                          market?.bias?.includes('BULL')
                            ? 'text-emerald-400'
                            : market?.bias?.includes('BEAR')
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                      <SummaryItem
                        label="SESGO OPCIONES"
                        value={derived.flowBias}
                        color={
                          derived.flowBias === 'ALCISTA'
                            ? 'text-emerald-400'
                            : derived.flowBias === 'BAJISTA'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                      <SummaryItem
                        label="TENDENCIA (CORTA)"
                        value={market?.spy?.trend ?? 'N/A'}
                        color={
                          market?.spy?.trend?.includes('BULL')
                            ? 'text-emerald-400'
                            : market?.spy?.trend?.includes('BEAR')
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                      <SummaryItem
                        label="TENDENCIA (MEDIA)"
                        value={market?.spyEMAs?.trend ?? market?.spy?.trend ?? 'N/A'}
                        color={
                          (market?.spyEMAs?.trend ?? market?.spy?.trend ?? '')
                            .includes('BULL')
                            ? 'text-emerald-400'
                            : (market?.spyEMAs?.trend ?? market?.spy?.trend ?? '')
                              .includes('BEAR')
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                      <SummaryItem
                        label="RIESGO (VIX)"
                        value={market?.vix
                          ? `${market.vix.value} — ${market.vix.regime}`
                          : 'N/A'}
                        color={
                          market?.vix?.regime === 'LOW'
                            ? 'text-emerald-400'
                            : market?.vix?.regime === 'NORMAL'
                              ? 'text-cyan-400'
                              : market?.vix?.regime === 'ELEVATED'
                                ? 'text-amber-400'
                                : 'text-red-400'
                        }
                      />
                      <SummaryItem
                        label="GEX RÉGIMEN"
                        value={derived.gexRegime}
                        color={
                          derived.gexRegime === 'POSITIVE'
                            ? 'text-emerald-400'
                            : derived.gexRegime === 'NEGATIVE'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* GEX Chart */}
                <GEXChart
                  data={report.gex?.data ?? []}
                  gammaFlip={report.gex?.gammaFlip}
                  spot={report.spot}
                  regime={derived.gexRegime}
                />

                {/* OI Distribution */}
                <OIDistributionChart
                  data={report.oiDistribution?.data ?? []}
                  callWall={report.oiDistribution?.callWall}
                  putWall={report.oiDistribution?.putWall}
                  maxPain={report.maxPain?.maxPainStrike}
                  spot={report.spot}
                  expDate={report.expDate}
                />

                {/* IV Term Structure */}
                <IVTermStructureChart
                  data={report.ivTermStructure?.data ?? []}
                  structure={report.ivTermStructure?.structure?.toUpperCase() ?? 'FLAT'}
                />
              </div>

              {/* ── Right Column ──────────────────────────────────────────── */}
              <div className="space-y-4">

                {/* Alert Pack */}
                <AlertPack
                  spot={report.spot}
                  putWall={report.oiDistribution?.putWall}
                  callWall={report.oiDistribution?.callWall}
                  gammaFlip={report.gex?.gammaFlip}
                  maxPain={report.maxPain?.maxPainStrike}
                  targets={{
                    target1: report.oiDistribution?.callWall,
                    target2: derived.topCallStrikes?.[0],
                    target3: derived.topCallStrikes?.[1],
                  }}
                />

                {/* IV Skew */}
                <IVSkewChart
                  data={report.ivSkew?.data ?? []}
                  spot={report.spot}
                  skew25d={report.ivSkew?.skew25d}
                />

                {/* Max Pain */}
                <MaxPainChart
                  data={report.maxPain?.data ?? []}
                  maxPainStrike={report.maxPain?.maxPainStrike}
                  spot={report.spot}
                />

                {/* Flow Score */}
                <FlowScoreCard
                  score={report.flow?.score}
                  tilt={report.flow?.tilt}
                  pcr={report.flow?.pcr}
                  unusualActivity={report.flow?.unusualActivity ?? []}
                />
              </div>
            </div>

            {/* ── C. Bottom Row ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

              {/* Preferred Contracts */}
              <PreferredContractsTable contracts={preferredContracts} />

              {/* Trade Plan */}
              <TradePlan
                spot={report.spot}
                callWall={report.oiDistribution?.callWall}
                putWall={report.oiDistribution?.putWall}
                gammaFlip={report.gex?.gammaFlip}
                maxPain={report.maxPain?.maxPainStrike}
                topCallStrikes={derived.topCallStrikes}
                topPutStrikes={derived.topPutStrikes}
                score={derived.conviction}
                bias={derived.flowBias}
              />

              {/* Dashboard Score */}
              <DashboardScore
                gexRegime={derived.gexRegime}
                pcr={report.oiDistribution?.pcr}
                ivStructure={report.ivTermStructure?.structure?.toUpperCase() ?? 'FLAT'}
                skew25d={report.ivSkew?.skew25d}
                spyTrend={market?.spy?.trend}
                rsi={market?.spy?.rsi ?? market?.spyEMAs?.rsi}
                distToCallWall={derived.distToCallWall}
                distToPutWall={derived.distToPutWall}
                maxPainAlignment={derived.maxPainAlignment}
                spot={report.spot}
                callWall={report.oiDistribution?.callWall}
                putWall={report.oiDistribution?.putWall}
                gammaFlip={report.gex?.gammaFlip}
              />
            </div>

            {/* ── Footer ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/40 px-2 pb-4">
              <span>
                Datos: Yahoo Finance v7 · Cálculos: Black-Scholes · Sin recomendación de inversión
              </span>
              {lastUpdated && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Última actualización: {lastUpdated.toLocaleTimeString('es-DO')}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function HeaderInput({ ticker, setTicker, onAnalyze, onKeyDown, isLoading, lastUpdated }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-card rounded-xl border border-border/50">
      <div className="flex items-center gap-2 mr-2">
        <Building2 className="w-5 h-5 text-cyan-400" />
        <span className="text-sm font-bold text-foreground hidden sm:inline">INSTITUTIONAL PRO</span>
      </div>
      <div className="flex-1 min-w-[200px]">
        <Input
          placeholder="Ticker (ej: QQQ, SPY, TSLA)"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={onKeyDown}
          className="bg-secondary border-border text-foreground font-mono text-sm"
        />
      </div>
      <Button
        onClick={onAnalyze}
        disabled={isLoading || !ticker}
        className="bg-cyan-600 hover:bg-cyan-700 text-white"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Search className="w-4 h-4 mr-2" />
        )}
        Analizar
      </Button>
      {lastUpdated && (
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {lastUpdated.toLocaleTimeString('es-DO')}
        </span>
      )}
    </div>
  );
}

function SummaryItem({ label, value, color = 'text-foreground' }) {
  return (
    <div className="bg-secondary/30 rounded-lg px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 block mb-0.5">
        {label}
      </span>
      <span className={`text-xs font-bold font-mono ${color}`}>{value}</span>
    </div>
  );
}
