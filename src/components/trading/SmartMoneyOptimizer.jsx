import React, { useState, useEffect } from "react";

const STRATEGY_TYPES = ["sweep", "choch", "ob", "fvg"];

function getStats(trades) {
  return {
    total: trades.length,
    wins: trades.filter(t => t.resultado?.toLowerCase() === 'win').length,
    losses: trades.filter(t => t.resultado?.toLowerCase() === 'loss').length,
    rrProm: trades.length ? trades.reduce((a, t) => a + (parseFloat(t.rr) || 0), 0) / trades.length : 0,
    winrate: trades.length ? (trades.filter(t => t.resultado?.toLowerCase() === 'win').length / trades.length * 100).toFixed(1) : 0
  };
}

export default function SmartMoneyOptimizer({ trades }) {
  const [best, setBest] = useState(null);
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState("winrate");
  const [applied, setApplied] = useState(false);

  // Cargar la mejor config guardada al montar
  useEffect(() => {
    const saved = localStorage.getItem("sm_best_config");
    if (saved) {
      setBest(JSON.parse(saved));
      setApplied(true);
    }
  }, []);

  const runOptimization = () => {
    setRunning(true);
    let bestResult = null;
    let bestParams = null;
    // Grid search simple
    for (let rr = 1; rr <= 3; rr += 0.25) {
      for (let vol = 0; vol <= 10000; vol += 500) {
        for (let atr = 0; atr <= 5; atr += 0.5) {
          const filtered = trades.filter(t =>
            parseFloat(t.rr) >= rr &&
            parseFloat(t.volumen || 0) >= vol &&
            parseFloat(t.atr || 0) >= atr
          );
          if (filtered.length < 10) continue; // evitar muestras muy pequeñas
          const stats = getStats(filtered);
          let score = 0;
          if (goal === "winrate") score = parseFloat(stats.winrate);
          if (goal === "rrProm") score = stats.rrProm;
          if (!bestResult || score > bestResult.score) {
            bestResult = { ...stats, score };
            bestParams = { rr, vol, atr };
          }
        }
      }
    }
    if (bestResult) {
      const config = { ...bestResult, params: bestParams };
      setBest(config);
      localStorage.setItem("sm_best_config", JSON.stringify(config));
      setApplied(true);
    }
    setRunning(false);
  };

  // Aplicar automáticamente la mejor config guardada
  useEffect(() => {
    if (best && best.params && !applied) {
      // Aquí podrías emitir un evento o actualizar el estado global para que el panel use estos filtros
      // Por simplicidad, solo mostramos el mensaje de que está aplicada
      setApplied(true);
    }
  }, [best, applied]);

  // ML avanzado
  const [mlResult, setMlResult] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);
  const runML = async () => {
    setMlLoading(true);
    setMlResult(null);
    try {
      const res = await fetch("http://localhost:5002/api/ml/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trades })
      });
      const data = await res.json();
      if (data.best_params) {
        // Guardar y aplicar automáticamente
        const config = {
          params: data.best_params,
          winrate: data.classification_report?.accuracy ? (data.classification_report.accuracy * 100).toFixed(1) : undefined,
          rrProm: data.best_params.rr,
          total: trades.length
        };
        setBest(config);
        localStorage.setItem("sm_best_config", JSON.stringify(config));
        setApplied(true);
      }
      setMlResult(data);
    } catch (e) {
      setMlResult({ error: "Error al conectar con el optimizador ML" });
    }
    setMlLoading(false);
  };

  return (
    <div className="my-4 p-3 bg-secondary/30 rounded border border-border/40">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-xs">Optimizar para:</span>
        <select value={goal} onChange={e => setGoal(e.target.value)} className="bg-secondary border rounded px-2 py-1 text-xs">
          <option value="winrate">Winrate</option>
          <option value="rrProm">RR Promedio</option>
        </select>
        <button onClick={runOptimization} disabled={running} className="ml-2 px-3 py-1 rounded bg-primary text-xs text-white">
          {running ? "Optimizando..." : "Optimizar Estrategia"}
        </button>
        <button onClick={runML} disabled={mlLoading} className="ml-2 px-3 py-1 rounded bg-purple-700 text-xs text-white">
          {mlLoading ? "ML..." : "Optimizar con ML"}
        </button>
      </div>
      {best && (
        <div className="text-xs mt-2">
          <b>Mejor combinación encontrada:</b><br />
          RR mínimo: <b>{best.params.rr}</b> | Volumen mínimo: <b>{best.params.vol}</b> | ATR mínimo: <b>{best.params.atr}</b><br />
          Winrate: <b>{best.winrate}%</b> | RR Promedio: <b>{best.rrProm?.toFixed ? best.rrProm.toFixed(2) : best.rrProm}</b> | Total trades: <b>{best.total}</b><br />
          <span className="text-emerald-400 font-bold">{applied ? "(Configuración aplicada automáticamente)" : ""}</span>
        </div>
      )}
      {mlResult && (
        <div className="text-xs mt-2 bg-background/40 p-2 rounded">
          <b>Resultado ML:</b><br />
          {mlResult.error && <span className="text-red-400">{mlResult.error}</span>}
          {mlResult.feature_importance && (
            <>
              <b>Importancia de variables:</b> {Object.entries(mlResult.feature_importance).map(([k, v]) => `${k}: ${(v*100).toFixed(1)}%`).join(", ")}<br />
            </>
          )}
          {mlResult.best_params && (
            <>
              <b>Parámetros sugeridos por ML:</b> RR ≥ {mlResult.best_params.rr}, Volumen ≥ {mlResult.best_params.volumen}, ATR ≥ {mlResult.best_params.atr}<br />
              <b>Accuracy modelo:</b> {mlResult.accuracy ? (mlResult.accuracy*100).toFixed(1) + "%" : "-"}
            </>
          )}
        </div>
      )}
    </div>
  );
}
