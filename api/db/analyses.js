import { sql } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const ticker = req.query.ticker;
      const rows = ticker
        ? await sql`SELECT * FROM analyses WHERE ticker = ${ticker} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM analyses ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json({ ok: true, data: rows });
    }

    if (req.method === 'POST') {
      const { ticker, setup, tendencia, precioEntrada, stopLoss, takeProfit, riesgo, resultado, rr, duracion, volumen, volatilidad, nota, score, clasificacion, mlProb } = req.body;
      if (!ticker) return res.status(400).json({ error: 'ticker required' });
      const [row] = await sql`
        INSERT INTO analyses
          (ticker, setup, tendencia, precio_entrada, stop_loss, take_profit, riesgo, resultado, rr, duracion, volumen, volatilidad, nota, score, clasificacion, ml_prob)
        VALUES
          (${ticker}, ${setup}, ${tendencia}, ${precioEntrada}, ${stopLoss}, ${takeProfit}, ${riesgo}, ${resultado}, ${rr}, ${duracion}, ${volumen}, ${volatilidad}, ${nota}, ${score}, ${clasificacion}, ${mlProb})
        RETURNING *
      `;
      return res.status(201).json({ ok: true, data: row });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(500).json({ error: 'db_error', message: String(err?.message || err) });
  }
}
