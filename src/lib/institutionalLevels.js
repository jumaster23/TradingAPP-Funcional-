// Institutional Levels Module — Options chain analysis via Yahoo Finance
// Max pain, call/put walls (OI), gamma exposure, put/call ratio

const YAHOO_PROXY = '/api/yahoo';

async function fetchOptionsChain(ticker, expiration = null) {
  let url = `${YAHOO_PROXY}/v7/finance/options/${ticker}`;
  if (expiration) url += `?date=${expiration}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.optionChain?.result?.[0] || null;
}

// Get available expiration dates
export async function getExpirations(ticker) {
  const data = await fetchOptionsChain(ticker);
  if (!data) return [];
  return (data.expirationDates || []).map(ts => {
    const d = new Date(ts * 1000);
    return { timestamp: ts, date: d.toISOString().split('T')[0] };
  });
}

// Max Pain — strike where option writers lose the least
export async function getMaxPain(ticker, expirationTs = null) {
  try {
    const data = await fetchOptionsChain(ticker, expirationTs);
    if (!data) return { error: 'No options data' };

    const calls = data.options?.[0]?.calls || [];
    const puts = data.options?.[0]?.puts || [];
    const currentPrice = data.quote?.regularMarketPrice || 0;
    const expDate = data.options?.[0]?.expirationDate;

    const strikes = [...new Set([
      ...calls.map(c => c.strike),
      ...puts.map(p => p.strike),
    ])].sort((a, b) => a - b);

    if (!strikes.length) return { error: 'No strikes found' };

    const pain = {};
    for (const strike of strikes) {
      let callPain = 0, putPain = 0;
      for (const c of calls) {
        if (strike > c.strike) callPain += (strike - c.strike) * (c.openInterest || 0);
      }
      for (const p of puts) {
        if (strike < p.strike) putPain += (p.strike - strike) * (p.openInterest || 0);
      }
      pain[strike] = callPain + putPain;
    }

    const maxPainStrike = Object.entries(pain).reduce(
      (min, [k, v]) => v < min[1] ? [+k, v] : min, [0, Infinity]
    )[0];

    const distancePct = currentPrice ? ((maxPainStrike - currentPrice) / currentPrice * 100) : 0;

    return {
      ticker,
      maxPain: +maxPainStrike.toFixed(2),
      currentPrice: +currentPrice.toFixed(2),
      distancePct: +distancePct.toFixed(2),
      expiration: expDate ? new Date(expDate * 1000).toISOString().split('T')[0] : null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Institutional OI walls — high OI strikes = support/resistance
export async function getInstitutionalWalls(ticker, expirationTs = null, topN = 5) {
  try {
    const data = await fetchOptionsChain(ticker, expirationTs);
    if (!data) return { error: 'No options data' };

    const calls = data.options?.[0]?.calls || [];
    const puts = data.options?.[0]?.puts || [];
    const currentPrice = data.quote?.regularMarketPrice || 0;

    // Sort by OI descending
    const callWalls = [...calls]
      .filter(c => c.openInterest > 0)
      .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
      .slice(0, topN)
      .map(c => ({ strike: c.strike, oi: c.openInterest || 0, volume: c.volume || 0, iv: +((c.impliedVolatility || 0) * 100).toFixed(1) }));

    const putWalls = [...puts]
      .filter(p => p.openInterest > 0)
      .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0))
      .slice(0, topN)
      .map(p => ({ strike: p.strike, oi: p.openInterest || 0, volume: p.volume || 0, iv: +((p.impliedVolatility || 0) * 100).toFixed(1) }));

    // Put/Call ratios
    const totalCallOI = calls.reduce((s, c) => s + (c.openInterest || 0), 0);
    const totalPutOI = puts.reduce((s, p) => s + (p.openInterest || 0), 0);
    const totalCallVol = calls.reduce((s, c) => s + (c.volume || 0), 0);
    const totalPutVol = puts.reduce((s, p) => s + (p.volume || 0), 0);

    const pcrOI = totalCallOI ? +(totalPutOI / totalCallOI).toFixed(3) : null;
    const pcrVolume = totalCallVol ? +(totalPutVol / totalCallVol).toFixed(3) : null;

    return {
      ticker,
      currentPrice: +currentPrice.toFixed(2),
      pcrOI,
      pcrVolume,
      totalCallOI,
      totalPutOI,
      callWalls,
      putWalls,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Gamma Exposure (GEX) estimation per strike
export async function getGammaExposure(ticker, expirationTs = null) {
  try {
    const data = await fetchOptionsChain(ticker, expirationTs);
    if (!data) return { error: 'No options data' };

    const calls = data.options?.[0]?.calls || [];
    const puts = data.options?.[0]?.puts || [];
    const spot = data.quote?.regularMarketPrice || 0;

    if (!spot) return { error: 'No spot price' };

    const strikes = [...new Set([
      ...calls.map(c => c.strike),
      ...puts.map(p => p.strike),
    ])].sort((a, b) => a - b);

    const gexByStrike = [];
    let totalGex = 0;

    for (const strike of strikes) {
      const call = calls.find(c => c.strike === strike);
      const put = puts.find(p => p.strike === strike);

      const callGamma = call?.gamma || 0;
      const callOI = call?.openInterest || 0;
      const putGamma = put?.gamma || 0;
      const putOI = put?.openInterest || 0;

      // GEX = (Call Gamma * Call OI - Put Gamma * Put OI) * 100 * Spot * 0.01
      const gex = (callGamma * callOI - putGamma * putOI) * 100 * spot * 0.01;
      totalGex += gex;

      gexByStrike.push({ strike, gex: Math.round(gex), callOI, putOI });
    }

    // Top GEX levels by absolute value
    const topGex = [...gexByStrike].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 10);

    // Gamma flip — where GEX crosses zero near spot
    let gammaFlip = null;
    const nearby = gexByStrike.filter(g => Math.abs(g.strike - spot) / spot < 0.05);
    for (let i = 0; i < nearby.length - 1; i++) {
      if (nearby[i].gex * nearby[i + 1].gex < 0) {
        gammaFlip = +((nearby[i].strike + nearby[i + 1].strike) / 2).toFixed(2);
        break;
      }
    }

    return {
      ticker,
      currentPrice: +spot.toFixed(2),
      totalGex: Math.round(totalGex),
      gexRegime: totalGex > 0 ? 'POSITIVE (pinning)' : 'NEGATIVE (volatile)',
      gammaFlip,
      topGexLevels: topGex,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Find best contracts for a given bias
export async function findContracts(ticker, bias = 'call', expirationTs = null) {
  try {
    const data = await fetchOptionsChain(ticker, expirationTs);
    if (!data) return [];

    const chain = bias === 'call'
      ? (data.options?.[0]?.calls || [])
      : (data.options?.[0]?.puts || []);
    const currentPrice = data.quote?.regularMarketPrice || 0;

    // Filter: near ATM, decent volume
    const filtered = chain
      .filter(c => {
        const moneyness = ((c.strike - currentPrice) / currentPrice) * 100;
        if (bias === 'call') return moneyness >= -3 && moneyness <= 5;
        return moneyness >= -5 && moneyness <= 3;
      })
      .filter(c => (c.volume || 0) >= 50)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 5);

    return filtered.map(c => ({
      symbol: c.contractSymbol,
      strike: c.strike,
      lastPrice: c.lastPrice || 0,
      bid: c.bid || 0,
      ask: c.ask || 0,
      spread: +((c.ask || 0) - (c.bid || 0)).toFixed(2),
      volume: c.volume || 0,
      openInterest: c.openInterest || 0,
      iv: +((c.impliedVolatility || 0) * 100).toFixed(1),
      delta: c.delta ?? null,
      gamma: c.gamma ?? null,
      theta: c.theta ?? null,
    }));
  } catch (e) {
    return [];
  }
}

// Full institutional analysis
export async function fullInstitutionalReport(ticker) {
  const [maxPain, walls, gex] = await Promise.all([
    getMaxPain(ticker),
    getInstitutionalWalls(ticker),
    getGammaExposure(ticker),
  ]);
  return { maxPain, walls, gex };
}
