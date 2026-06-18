import React from 'react';

export default function TradePanel({ signal, scanResult, convergence, livePrice, ticker, session, onChangeTicker }) {
  const isGo = signal?.phase === 'GO';
  const isWatch = signal?.phase === 'WATCH';
  const trade = signal?.trade;
  const details = signal?.details;
  const approaching = signal?.approaching;
  const levels = signal?.levels?.filter(l => l.name !== 'VWAP') || [];

  // Find closest level to current price
  const price = livePrice || signal?.price || 0;
  const closestLevel = levels
    .map(l => ({ ...l, dist: Math.abs(price - l.price), dir: price < l.price ? 'CALL' : 'PUT' }))
    .sort((a, b) => a.dist - b.dist)[0];

  // Best signal across ALL tickers
  const bestOther = scanResult?.signals?.find(s => s.ticker !== ticker);
  const bestGo = scanResult?.signals?.[0];

  // Stop for display
  const sd = trade?.risk || (price < 100 ? 0.5 : price < 250 ? 1 : price < 400 ? 1.5 : price < 550 ? 2 : 2.5);

  // === GO ===
  if (isGo && trade) {
    return (
      <div className={`rounded-2xl p-6 border-2 animate-pulse ${details?.direction === 'CALL' ? 'bg-green-500/20 border-green-400' : 'bg-red-500/20 border-red-400'}`}>
        <div className="text-center">
          <div className="text-5xl mb-2">🟢</div>
          <div className={`text-4xl font-black ${details?.direction === 'CALL' ? 'text-green-400' : 'text-red-400'}`}>
            {details?.direction === 'CALL' ? 'COMPRA CALL' : 'COMPRA PUT'}
          </div>
          <div className="text-2xl font-black text-white mt-1">{ticker} ${trade.entry}</div>
          <div className="text-sm text-white/50 mt-1">
            {details?.type === 'BREAKOUT' ? 'Rompió' : 'Rebotó en'} {details?.level} · NQ+SPX confirman ✅
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4">
          <div className="rounded-xl bg-red-500/20 p-4 text-center">
            <div className="text-xs text-red-300">Si baja aquí → SALIR</div>
            <div className="text-2xl font-black text-red-400 font-mono mt-1">${trade.stop}</div>
            <div className="text-[10px] text-red-300/50">Stop Loss</div>
          </div>
          <div className="rounded-xl bg-white/10 p-4 text-center">
            <div className="text-xs text-white/50">Entrada</div>
            <div className="text-2xl font-black text-white font-mono mt-1">${trade.entry}</div>
            <div className="text-[10px] text-white/30">Comprar aquí</div>
          </div>
          <div className="rounded-xl bg-green-500/20 p-4 text-center">
            <div className="text-xs text-green-300">Si sube aquí → GANAR</div>
            <div className="text-2xl font-black text-green-400 font-mono mt-1">${trade.target_3 || trade.target}</div>
            <div className="text-[10px] text-green-300/50">Target</div>
          </div>
        </div>

        <div className="mt-4 text-center text-sm text-blue-300">
          📌 Si sube a ${trade.beLevel} → mover stop a ${trade.entry} (ya no pierdes)
        </div>
      </div>
    );
  }

  // === WATCH ===
  if (isWatch && approaching) {
    const entryPrice = approaching.levelPrice;
    const slPrice = approaching.direction === 'CALL' ? +(entryPrice - sd).toFixed(2) : +(entryPrice + sd).toFixed(2);
    const tpPrice = approaching.direction === 'CALL' ? +(entryPrice + sd * 3).toFixed(2) : +(entryPrice - sd * 3).toFixed(2);

    return (
      <div className="rounded-2xl p-6 border-2 border-dashed border-yellow-400 bg-yellow-500/10">
        <div className="text-center">
          <div className="text-5xl mb-2">🟡</div>
          <div className="text-3xl font-black text-yellow-300">PREPARARSE</div>
          <div className="text-xl text-white mt-2">
            {ticker} va hacia <span className={approaching.direction === 'CALL' ? 'text-green-400' : 'text-red-400'}>${approaching.levelPrice}</span>
          </div>
          <div className="text-lg text-yellow-400 mt-1">
            Falta <span className="font-mono font-bold">${approaching.distance}</span> para el nivel
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-black/20 p-4">
          <div className="text-center text-sm text-white/50 mb-3">
            Cuando llegue a ${entryPrice} y NQ+SPX confirmen:
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] text-white/30">Stop</div>
              <div className="text-lg font-bold text-red-400 font-mono">${slPrice}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30">Entrada</div>
              <div className="text-lg font-bold text-white font-mono">${entryPrice}</div>
            </div>
            <div>
              <div className="text-[10px] text-white/30">Target</div>
              <div className="text-lg font-bold text-green-400 font-mono">${tpPrice}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 text-center text-[10px] text-white/30">
          NQ+SPX: {convergence?.converging ? '🟢 Listos' : '🔴 Esperando'} · Solo entrar si ambos confirman
        </div>
      </div>
    );
  }

  // === WAITING ===
  return (
    <div className="rounded-2xl p-6 border border-white/10 bg-white/5">
      <div className="text-center">
        <div className="text-4xl mb-2">👀</div>
        <div className="text-2xl font-bold text-white/50">Mirando {ticker}</div>
        <div className="text-lg text-white font-mono mt-1">${price.toFixed(2)}</div>
      </div>

      {/* What to watch */}
      {closestLevel && (
        <div className="mt-5 rounded-xl bg-white/5 p-4 text-center">
          <div className="text-sm text-white/40">Nivel más cercano</div>
          <div className={`text-3xl font-black font-mono mt-1 ${closestLevel.dir === 'CALL' ? 'text-green-400' : 'text-red-400'}`}>
            ${closestLevel.price}
          </div>
          <div className="text-sm text-white/30 mt-1">
            {closestLevel.name} · {closestLevel.dir === 'CALL' ? '📈 si sube ahí → CALL' : '📉 si baja ahí → PUT'}
          </div>
          <div className="text-lg text-yellow-400 font-mono mt-2">
            Falta ${closestLevel.dist.toFixed(2)}
          </div>

          {/* Preview trade */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] opacity-50">
            <div>
              <div className="text-white/30">Stop</div>
              <div className="font-mono text-red-400">
                ${closestLevel.dir === 'CALL' ? (closestLevel.price - sd).toFixed(2) : (closestLevel.price + sd).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-white/30">Entry</div>
              <div className="font-mono text-white">${closestLevel.price}</div>
            </div>
            <div>
              <div className="text-white/30">Target</div>
              <div className="font-mono text-green-400">
                ${closestLevel.dir === 'CALL' ? (closestLevel.price + sd * 3).toFixed(2) : (closestLevel.price - sd * 3).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* All levels */}
      {levels.length > 1 && (
        <div className="mt-3 flex justify-center gap-3 text-[10px]">
          {levels.map((l, i) => (
            <span key={i} className={`font-mono ${Math.abs(price - l.price) < 2 ? 'text-yellow-400 font-bold' : 'text-white/20'}`}>
              {l.name} ${l.price}
            </span>
          ))}
        </div>
      )}

      {/* Best other ticker */}
      {bestGo && bestGo.ticker !== ticker && (
        <div className="mt-4 text-center">
          <button onClick={() => onChangeTicker?.(bestGo.ticker)}
            className="px-4 py-2 rounded-xl bg-green-500/20 text-green-400 text-sm font-bold hover:bg-green-500/30 transition-all">
            💡 {bestGo.ticker} tiene señal {bestGo.signal} @{bestGo.details?.level} — ir ahí
          </button>
        </div>
      )}
      {!bestGo && bestOther && (
        <div className="mt-3 text-center text-[10px] text-white/20">
          {scanResult?.watching?.length || 0} tickers acercándose a niveles
        </div>
      )}

      <div className="mt-3 text-center text-[10px] text-white/15">
        NQ+SPX: {convergence?.converging ? '🟢' : '🔴'} · {session?.label || ''}
      </div>
    </div>
  );
}
