import { sql } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const days = Math.min(parseInt(req.query.days) || 30, 90);
      const rows = await sql`
        SELECT * FROM daily_metrics
        ORDER BY date DESC
        LIMIT ${days}
      `;
      // Summary stats
      const [summary] = await sql`
        SELECT
          COALESCE(SUM(trade_count), 0) AS total_trades,
          COALESCE(SUM(wins), 0)        AS total_wins,
          COALESCE(SUM(losses), 0)      AS total_losses,
          CASE WHEN SUM(trade_count) > 0
            THEN ROUND(SUM(wins)::numeric / SUM(trade_count) * 100, 1)
            ELSE 0 END                  AS winrate
        FROM daily_metrics
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      `;
      // Today's count (for 0DTE limit enforcement)
      const today = new Date().toISOString().slice(0, 10);
      const [todayRow] = await sql`
        SELECT trade_count FROM daily_metrics WHERE date = ${today}
      `;
      return res.json({ ok: true, data: rows, summary, todayCount: todayRow?.trade_count || 0 });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    res.status(500).json({ error: 'db_error', message: String(err?.message || err) });
  }
}
