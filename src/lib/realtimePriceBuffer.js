// Módulo para obtener precios en tiempo real de Yahoo Finance y construir velas OHLC
// Se puede extender para TipRanks y Barchart

export async function fetchYahooPrice(ticker) {
  // Usar endpoint proxy del backend para evitar CORS
  const url = `/api/yahoo/chart/${ticker}?interval=1s&range=1d`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const last = data.chart.result[0].meta.regularMarketPrice;
    return Number(last);
  } catch (e) {
    return null;
  }
}

export class PriceBuffer {
  constructor() {
    this.prices = [];
  }
  add(price) {
    const now = Date.now();
    this.prices.push({ price, ts: now });
    // Mantener solo los últimos 10 minutos
    this.prices = this.prices.filter(p => now - p.ts < 10 * 60 * 1000);
  }
  // Genera vela OHLC de 1 minuto
  getCandle1m() {
    const now = Date.now();
    const oneMinAgo = now - 60 * 1000;
    const arr = this.prices.filter(p => p.ts >= oneMinAgo);
    if (arr.length === 0) return null;
    return {
      open: arr[0].price,
      high: Math.max(...arr.map(p => p.price)),
      low: Math.min(...arr.map(p => p.price)),
      close: arr[arr.length - 1].price,
      ts: arr[0].ts
    };
  }
  // Genera vela OHLC de 5 minutos
  getCandle5m() {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const arr = this.prices.filter(p => p.ts >= fiveMinAgo);
    if (arr.length === 0) return null;
    return {
      open: arr[0].price,
      high: Math.max(...arr.map(p => p.price)),
      low: Math.min(...arr.map(p => p.price)),
      close: arr[arr.length - 1].price,
      ts: arr[0].ts
    };
  }
}

// Ejemplo de uso:
// const buffer = new PriceBuffer();
// setInterval(async () => {
//   const price = await fetchYahooPrice('AAPL');
//   if (price) buffer.add(price);
// }, 1000);
// setInterval(() => {
//   const candle1m = buffer.getCandle1m();
//   const candle5m = buffer.getCandle5m();
//   // Usar candle1m y candle5m en la estrategia
// }, 60000);
