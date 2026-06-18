import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const sql = neon(process.env.DATABASE_URL);

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id          SERIAL PRIMARY KEY,
      ticker      TEXT NOT NULL,
      signal      TEXT NOT NULL,
      entry       NUMERIC(12,4),
      sl          NUMERIC(12,4),
      tp          NUMERIC(12,4),
      exit_price  NUMERIC(12,4),
      result      TEXT,
      score       INTEGER,
      setup_grade TEXT,
      atr_used    NUMERIC(8,4),
      volume_zone TEXT,
      session     TEXT,
      opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at   TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analyses (
      id              SERIAL PRIMARY KEY,
      ticker          TEXT NOT NULL,
      setup           TEXT,
      tendencia       TEXT,
      precio_entrada  NUMERIC(12,4),
      stop_loss       NUMERIC(12,4),
      take_profit     NUMERIC(12,4),
      riesgo          TEXT,
      resultado       TEXT,
      rr              NUMERIC(6,2),
      duracion        TEXT,
      volumen         NUMERIC(16,2),
      volatilidad     TEXT,
      nota            TEXT,
      score           INTEGER,
      clasificacion   TEXT,
      ml_prob         NUMERIC(5,4),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS signals (
      id            SERIAL PRIMARY KEY,
      ticker        TEXT NOT NULL,
      signal_type   TEXT NOT NULL,
      entry         NUMERIC(12,4),
      sl            NUMERIC(12,4),
      tp            NUMERIC(12,4),
      probability   INTEGER,
      score         INTEGER,
      setup_grade   TEXT,
      atr_used_pct  NUMERIC(5,4),
      atr_remaining NUMERIC(8,4),
      regime        TEXT,
      volume_zone   TEXT,
      session       TEXT,
      reason        TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id          SERIAL PRIMARY KEY,
      date        DATE NOT NULL UNIQUE,
      trade_count INTEGER DEFAULT 0,
      wins        INTEGER DEFAULT 0,
      losses      INTEGER DEFAULT 0,
      total_rr    NUMERIC(8,2) DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}
