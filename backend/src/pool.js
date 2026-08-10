const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL is not set — copy .env.example to .env and point it at your Postgres instance.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers (Render, Railway, RDS, Supabase, etc.) require SSL.
  // Set PGSSL=true in .env when deploying to one of those.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});

module.exports = { pool };
