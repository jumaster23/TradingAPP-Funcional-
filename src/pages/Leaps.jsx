import React, { useEffect, useState } from 'react';

const YAHOO_PROXY = '/api/yahoo';
const TICKERS = ['SPY','QQQ','NVDA','AAPL','MSFT','META','PLTR','AMD','GOOGL','TSLA'];

async function fetchChart(ticker, interval, range) {
  const res = await fetch(`${YAHOO_PROXY}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  return { closes: q.close || [], highs: q.high || [], lows: q.low || [] };
}

async function fetchOptions(ticker, expiration) {
  const url = expiration
    ? `${YAHOO_PROXY}/v7/finance/options/${ticker}?date=${expiration}`
    : `${YAHOO_PROXY}/v7/finance/options/${ticker}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.optionChain?.result?.[0] || null;
}

async function analyzeLeaps(ticker) {
  try {
    const [daily, optData] = await Promise.all([
      fetchChart(ticker, '1d', '1y'),
      fetchOptions(ticker),
    ]);

    if (!daily || !optData) return null;

    const closes = daily.closes.filter(v => v != null);
    const highs = daily.highs.filter(v => v != null);
    const lows = daily.lows.filter(v => v != null);
    if (closes.length < 50) return null;

    const price = closes[closes.length - 1];
    const yrHigh = Math.max(...highs);
    const yrLow = Math.min(...lows);
    const distHigh = ((price - yrHigh) / yrHigh) * 100;
    const distLow = ((price - yrLow) / yrLow) * 100;

    // Trends
    const t1m = closes.length >= 22 ? ((closes[closes.length-1] - closes[closes.length-22]) / closes[closes.length-22]) * 100 : 0;
    const t3m = closes.length >= 66 ? ((closes[closes.length-1] - closes[closes.length-66]) / closes[closes.length-66]) * 100 : 0;
    const t6m = closes.length >= 132 ? ((closes[closes.length-1] - closes[closes.length-132]) / closes[closes.length-132]) * 100 : 0;

    // EMAs
    const ema50 = closes.slice(-50).reduce((a,b) => a+b, 0) / 50;
    const ema200 = closes.length >= 200 ? closes.slice(-200).reduce((a,b) => a+b, 0) / 200 : closes.reduce((a,b) => a+b, 0) / closes.length;

    // Score
    let score = 0;
    const reasons = [];
    if (t3m > 10) { score += 3; reasons.push(`Tendencia 3m fuerte +${t3m.toFixed(0)}%`); }
    else if (t3m > 5) { score += 2; reasons.push(`Tendencia 3m +${t3m.toFixed(0)}%`); }
    else if (t3m < -10) { score += 2; reasons.push(`Oversold 3m ${t3m.toFixed(0)}% — posible rebote`); }
    if (price > ema50 && price > ema200) { score += 2; reasons.push('Arriba EMA50 y EMA200'); }
    else if (price > ema200) { score += 1; reasons.push('Arriba EMA200'); }
    if (distHigh > -5 && distHigh <= 0) { score += 1; reasons.push('Cerca de 52w high'); }
    else if (distHigh < -20) { score += 2; reasons.push(`Descuento ${distHigh.toFixed(0)}% del high`); }
    if (t1m > 5) { score += 1; reasons.push(`Momentum +${t1m.toFixed(0)}%`); }

    const direction = t3m > 0 && price > ema50 ? 'CALL' : t3m < -5 && price < ema50 ? 'PUT' : 'NEUTRAL';

    // LEAPS expirations (1+ year out)
    const expirations = (optData.expirationDates || [])
      .map(ts => ({ ts, date: new Date(ts * 1000).toISOString().split('T')[0] }))
      .filter(e => e.date >= '2027-01-01');

    let contracts = [];
    if (expirations.length > 0) {
      const leapsData = await fetchOptions(ticker, expirations[0].ts);
      if (leapsData?.options?.[0]) {
        const calls = leapsData.options[0].calls || [];
        const puts = leapsData.options[0].puts || [];
        const currentPrice = leapsData.quote?.regularMarketPrice || price;

        // ATM and OTM calls
        const atmStrike = Math.round(currentPrice / 5) * 5;
        const otmStrike = atmStrike + (currentPrice > 500 ? 20 : 10);

        for (const strike of [atmStrike, otmStrike]) {
          const call = calls.find(c => Math.abs(c.strike - strike) < 3);
          if (call) {
            contracts.push({
              type: 'CALL',
              strike: call.strike,
              last: call.lastPrice || 0,
              bid: call.bid || 0,
              ask: call.ask || 0,
              iv: ((call.impliedVolatility || 0) * 100),
              oi: call.openInterest || 0,
              volume: call.volume || 0,
              cost: (call.lastPrice || 0) * 100,
              delta: call.delta || null,
              label: call.strike <= currentPrice ? 'ITM' : call.strike === atmStrike ? 'ATM' : 'OTM',
            });
          }
        }

        // ATM put for hedge or bearish play
        const putAtm = puts.find(p => Math.abs(p.strike - atmStrike) < 3);
        if (putAtm) {
          contracts.push({
            type: 'PUT',
            strike: putAtm.strike,
            last: putAtm.lastPrice || 0,
            bid: putAtm.bid || 0,
            ask: putAtm.ask || 0,
            iv: ((putAtm.impliedVolatility || 0) * 100),
            oi: putAtm.openInterest || 0,
            volume: putAtm.volume || 0,
            cost: (putAtm.lastPrice || 0) * 100,
            label: 'ATM',
          });
        }
      }
    }

    return {
      ticker,
      price: +price.toFixed(2),
      yrHigh: +yrHigh.toFixed(2),
      yrLow: +yrLow.toFixed(2),
      distHigh: +distHigh.toFixed(1),
      distLow: +distLow.toFixed(1),
      t1m: +t1m.toFixed(1),
      t3m: +t3m.toFixed(1),
      t6m: +t6m.toFixed(1),
      ema50: +ema50.toFixed(2),
      ema200: +ema200.toFixed(2),
      above50: price > ema50,
      above200: price > ema200,
      score,
      reasons,
      direction,
      expiration: expirations[0]?.date || null,
      contracts,
    };
  } catch (e) {
    return null;
  }
}

export default function Leaps() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all(TICKERS.map(t => analyzeLeaps(t))).then(results => {
      const valid = results.filter(r => r).sort((a, b) => b.score - a.score);
      setData(valid);
      setLoading(false);
    });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-3 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">LEAPS 2.0 — Oportunidades a largo plazo</h1>
        <span className="text-[10px] text-white/30">Vencimiento Enero 2027+</span>
      </div>

      {loading && (
        <div className="text-center py-16 text-white/30">
          <div className="text-2xl mb-2 animate-spin">⏳</div>
          Analizando {TICKERS.length} tickers...
        </div>
      )}

      {!loading && data.map((d, i) => (
        <div key={i} className={`rounded-xl border p-4 transition-all cursor-pointer ${
          d.score >= 5 ? 'border-green-500/30 bg-green-500/5' :
          d.score >= 3 ? 'border-yellow-500/30 bg-yellow-500/5' :
          'border-white/10 bg-white/5'
        }`} onClick={() => setExpanded(expanded === i ? null : i)}>

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl font-black text-white">{d.ticker}</span>
              <span className="text-lg font-bold text-white font-mono">${d.price}</span>
              <span className={`text-sm font-bold ${d.direction === 'CALL' ? 'text-green-400' : d.direction === 'PUT' ? 'text-red-400' : 'text-yellow-400'}`}>
                {d.direction === 'CALL' ? '📈 CALL' : d.direction === 'PUT' ? '📉 PUT' : '➡️ NEUTRAL'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">{'⭐'.repeat(Math.min(d.score, 5))}</span>
              <span className="text-[10px] text-white/30">{expanded === i ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Quick stats */}
          <div className="mt-2 grid grid-cols-6 gap-2 text-center text-[10px]">
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">1 Mes</div>
              <div className={`font-bold font-mono ${d.t1m > 0 ? 'text-green-400' : 'text-red-400'}`}>{d.t1m > 0 ? '+' : ''}{d.t1m}%</div>
            </div>
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">3 Meses</div>
              <div className={`font-bold font-mono ${d.t3m > 0 ? 'text-green-400' : 'text-red-400'}`}>{d.t3m > 0 ? '+' : ''}{d.t3m}%</div>
            </div>
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">6 Meses</div>
              <div className={`font-bold font-mono ${d.t6m > 0 ? 'text-green-400' : 'text-red-400'}`}>{d.t6m > 0 ? '+' : ''}{d.t6m}%</div>
            </div>
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">52w High</div>
              <div className={`font-bold font-mono ${d.distHigh > -5 ? 'text-green-400' : 'text-yellow-400'}`}>{d.distHigh}%</div>
            </div>
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">EMA50</div>
              <div className={`font-bold ${d.above50 ? 'text-green-400' : 'text-red-400'}`}>{d.above50 ? '✅' : '❌'} ${d.ema50}</div>
            </div>
            <div className="rounded bg-black/20 p-1.5">
              <div className="text-white/30">EMA200</div>
              <div className={`font-bold ${d.above200 ? 'text-green-400' : 'text-red-400'}`}>{d.above200 ? '✅' : '❌'} ${d.ema200}</div>
            </div>
          </div>

          {/* Reasons */}
          <div className="mt-2 flex flex-wrap gap-1">
            {d.reasons.map((r, j) => (
              <span key={j} className="text-[8px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">✅ {r}</span>
            ))}
          </div>

          {/* Expanded: Contracts */}
          {expanded === i && (
            <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
              <p className="text-[10px] text-white/40 font-bold">CONTRATOS LEAPS — Exp: {d.expiration || 'N/A'}</p>

              {d.contracts.length > 0 ? (
                <div className="space-y-1.5">
                  {d.contracts.map((c, j) => (
                    <div key={j} className={`rounded-lg p-3 ${c.type === 'CALL' ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${c.type === 'CALL' ? 'text-green-400' : 'text-red-400'}`}>{c.type}</span>
                          <span className="text-white font-mono font-bold">${c.strike}</span>
                          <span className="text-[9px] text-white/30">{c.label}</span>
                        </div>
                        <span className="text-lg font-black text-white font-mono">${c.cost.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-5 gap-2 text-[9px] text-white/50">
                        <div>Last: <span className="font-mono text-white/70">${c.last.toFixed(2)}</span></div>
                        <div>Bid/Ask: <span className="font-mono">${c.bid.toFixed(2)}/${c.ask.toFixed(2)}</span></div>
                        <div>IV: <span className="font-mono">{c.iv.toFixed(0)}%</span></div>
                        <div>OI: <span className="font-mono">{c.oi.toLocaleString()}</span></div>
                        <div>Vol: <span className="font-mono">{c.volume.toLocaleString()}</span></div>
                      </div>
                      <div className="mt-1 text-[9px] text-white/30">
                        1 contrato = ${c.cost.toLocaleString()} · Controla 100 acciones · Exp {d.expiration}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-white/30">Sin contratos LEAPS disponibles</div>
              )}

              {/* Break-even analysis */}
              {d.contracts.length > 0 && d.contracts[0].type === 'CALL' && (
                <div className="rounded-lg bg-white/5 p-2 text-[10px]">
                  <p className="text-white/40 font-bold">BREAK-EVEN:</p>
                  <p className="text-white/60 mt-1">
                    {d.ticker} necesita subir a ${(d.contracts[0].strike + d.contracts[0].last).toFixed(2)} ({(((d.contracts[0].strike + d.contracts[0].last - d.price) / d.price) * 100).toFixed(1)}%) para break-even al vencimiento.
                  </p>
                </div>
              )}

              <div className="text-[8px] text-white/20">
                52w Range: ${d.yrLow} — ${d.yrHigh} · Precios de opciones pueden tener delay
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="text-center text-[9px] text-white/20 py-2">
        LEAPS = opciones con vencimiento 1+ año · Menos theta decay · Mayor costo · Click para ver contratos
      </div>
    </div>
  );
}
