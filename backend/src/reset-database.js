import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to reset the company data.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const result = await pool.query("DELETE FROM finance_app_state WHERE id = 1");
  console.log(`Removed ${result.rowCount} company data row(s). Restart the backend to initialize a blank company.`);
} finally {
  await pool.end();
}
