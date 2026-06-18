import { sql } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const ticker = req.query.ticker;
      const rows = ticker
        ? await sql`SELECT * FROM trades WHERE ticker = ${ticker} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM trades ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json({ ok: true, data: rows });
    }

    if (req.method === 'POST') {
      const { ticker, signal, entry, sl, tp, score, setupGrade, atrUsed, volumeZone, session } = req.body;
      if (!ticker || !signal) return res.status(400).json({ error: 'ticker and signal required' });
      const [row] = await sql`
        INSERT INTO trades (ticker, signal, entry, sl, tp, score, setup_grade, atr_used, volume_zone, session)
        VALUES (${ticker}, ${signal}, ${entry}, ${sl}, ${tp}, ${score}, ${setupGrade}, ${atrUsed}, ${volumeZone}, ${session})
        RETURNING *
      `;
      return res.status(201).json({ ok: true, data: row });
    }

    if (req.method === 'PATCH') {
      const { id, exitPrice, result, closedAt } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const [row] = await sql`
        UPDATE trades SET exit_price = ${exitPrice}, result = ${result}, closed_at = ${closedAt || new Date().toISOString()}
        WHERE id = ${id} RETURNING *
      `;
      // update daily_metrics
      const today = new Date().toISOString().slice(0, 10);
      await sql`
        INSERT INTO daily_metrics (date, trade_count, wins, losses)
        VALUES (${today}, 1, ${result === 'SUCCESS' ? 1 : 0}, ${result === 'FAILURE' ? 1 : 0})
        ON CONFLICT (date) DO UPDATE SET
          trade_count = daily_metrics.trade_count + 1,
          wins        = daily_metrics.wins   + ${result === 'SUCCESS' ? 1 : 0},
          losses      = daily_metrics.losses + ${result === 'FAILURE' ? 1 : 0},
          updated_at  = NOW()
      `;
      return res.json({ ok: true, data: row });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(500).json({ error: 'db_error', message: String(err?.message || err) });
  }
}
