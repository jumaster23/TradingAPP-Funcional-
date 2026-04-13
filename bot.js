import fs from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const DATASET_PATH = './dataset.json';
const DEFAULT_THRESHOLD = 0.7;
const STOP_DRAWDOWN_PCT = 0.10;

function loadDataset() {
  if (!fs.existsSync(DATASET_PATH)) {
    fs.writeFileSync(DATASET_PATH, '[]\n', 'utf-8');
  }
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function saveDataset(data) {
  fs.writeFileSync(DATASET_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

export function appendTradeSample(sample) {
  const dataset = loadDataset();
  dataset.push(sample);
  saveDataset(dataset);
}

export function getMLPrediction(features) {
  const input = JSON.stringify(features);
  const raw = execFileSync('python', ['predict.py', input, '--json'], { encoding: 'utf-8' }).trim();
  const parsed = JSON.parse(raw);
  return {
    probFinal: Number(parsed?.prob_final ?? 0),
    modelProbs: parsed?.models || {},
  };
}

export function getMLProbability(features) {
  return getMLPrediction(features).probFinal;
}

export function detectMarketRegime(features = {}) {
  const atr = Number(features?.atr_15m ?? 0);
  const trendStrength = Math.abs(Number(features?.trend_strength ?? 0));
  if (atr > 2 && trendStrength > 0.5) return 'trend';
  if (atr < 0.8) return 'range';
  return 'mixed';
}

export function chooseThreshold({ mercadoVolatil = false, regime = 'mixed' } = {}) {
  if (mercadoVolatil) return 0.75;
  if (regime === 'trend') return 0.68;
  if (regime === 'range') return 0.72;
  return 0.65;
}

export function shouldExecuteTrade({ estrategiaBase, prob, threshold = DEFAULT_THRESHOLD }) {
  return Boolean(estrategiaBase) && Number.isFinite(prob) && prob >= threshold;
}

export function sizeMultiplierByProbability(prob) {
  if (prob > 0.75) return 1.0;
  if (prob > 0.65) return 0.5;
  return 0;
}

export function calculatePositionSize({ account, entry, stopLoss, prob }) {
  const riskBudget = Number(account || 0) * 0.01;
  const distance = Math.max(0.0001, Math.abs(Number(entry || 0) - Number(stopLoss || 0)));
  const baseSize = riskBudget / distance;
  const multiplier = sizeMultiplierByProbability(prob) * Math.max(0, Math.min(1, Number(prob || 0)));
  return {
    units: baseSize * multiplier,
    riskBudget,
    stopDistance: distance,
    multiplier,
  };
}

export function computePerformanceStats(trades = []) {
  const pnlSeries = trades.map((t) => Number(t?.pnl || 0));
  const wins = pnlSeries.filter((v) => v > 0);
  const losses = pnlSeries.filter((v) => v < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const winrate = pnlSeries.length ? wins.length / pnlSeries.length : 0;

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const pnl of pnlSeries) {
    equity += pnl;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  const mean = pnlSeries.length ? pnlSeries.reduce((a, b) => a + b, 0) / pnlSeries.length : 0;
  const variance = pnlSeries.length
    ? pnlSeries.reduce((acc, v) => acc + ((v - mean) ** 2), 0) / pnlSeries.length
    : 0;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(252) : 0;

  return { winrate, profitFactor, maxDrawdown, sharpe };
}

export function evaluateSetup({ features, estrategiaBase, mercadoVolatil = false, account = 10000, recentTrades = [] }) {
  const ml = getMLPrediction(features);
  const prob = ml.probFinal;
  const regime = detectMarketRegime(features);
  const threshold = chooseThreshold({ mercadoVolatil, regime });
  const stats = computePerformanceStats(recentTrades);

  if (stats.maxDrawdown > STOP_DRAWDOWN_PCT) {
    return {
      prob,
      threshold,
      regime,
      ejecutar: false,
      action: 'STOP_TRADING',
      reason: `Drawdown excedido: ${(stats.maxDrawdown * 100).toFixed(2)}%`,
      stats,
      modelProbs: ml.modelProbs,
    };
  }

  const ejecutar = shouldExecuteTrade({ estrategiaBase, prob, threshold });
  if (!ejecutar) {
    return { prob, threshold, regime, ejecutar: false, action: 'NO_TRADE', stats, modelProbs: ml.modelProbs };
  }

  const position = calculatePositionSize({
    account,
    entry: features?.entry_price ?? features?.entry,
    stopLoss: features?.stop_loss ?? features?.sl,
    prob,
  });

  return {
    prob,
    threshold,
    regime,
    ejecutar: true,
    action: 'ENTER',
    size_units: position.units,
    size_multiplier: position.multiplier,
    stats,
    modelProbs: ml.modelProbs,
  };
}

export function trainModelNow() {
  execSync('python train_model.py', { stdio: 'inherit' });
}

export function startAutoTraining(intervalMs = 1000 * 60 * 60 * 24) {
  return setInterval(() => {
    trainModelNow();
    console.log('Modelo actualizado');
  }, intervalMs);
}

// Ejemplo minimo de uso en tiempo real
if (process.argv.includes('--demo')) {
  const features = {
    success_probability: 0.68,
    atr_15m: 1.2,
    trend_strength: 0.8,
    entry_price: 510.2,
    stop_loss: 508.9,
    gamma_signal_alignment: 1,
    volume_spike: 1,
    bollinger_position: 0.9,
  };

  const decision = evaluateSetup({
    features,
    estrategiaBase: true,
    mercadoVolatil: false,
    account: 25000,
    recentTrades: [{ pnl: 120 }, { pnl: -80 }, { pnl: 45 }, { pnl: -30 }],
  });

  console.log(JSON.stringify(decision, null, 2));
}
