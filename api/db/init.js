import { initDB } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    await initDB();
    res.json({ ok: true, message: 'Schema created/verified' });
  } catch (err) {
    res.status(500).json({ error: 'init_failed', message: String(err?.message || err) });
  }
}
