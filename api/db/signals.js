import { sql } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const ticker = req.query.ticker;
      const rows = ticker
        ? await sql`SELECT * FROM signals WHERE ticker = ${ticker} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM signals ORDER BY created_at DESC LIMIT ${limit}`;
      return res.json({ ok: true, data: rows });
    }

    if (req.method === 'POST') {
      const { ticker, signalType, entry, sl, tp, probability, score, setupGrade, atrUsedPct, atrRemaining, regime, volumeZone, session, reason } = req.body;
      if (!ticker || !signalType) return res.status(400).json({ error: 'ticker and signalType required' });
      const [row] = await sql`
        INSERT INTO signals
          (ticker, signal_type, entry, sl, tp, probability, score, setup_grade, atr_used_pct, atr_remaining, regime, volume_zone, session, reason)
        VALUES
          (${ticker}, ${signalType}, ${entry}, ${sl}, ${tp}, ${probability}, ${score}, ${setupGrade}, ${atrUsedPct}, ${atrRemaining}, ${regime}, ${volumeZone}, ${session}, ${reason})
        RETURNING *
      `;
      return res.status(201).json({ ok: true, data: row });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(500).json({ error: 'db_error', message: String(err?.message || err) });
  }
}
