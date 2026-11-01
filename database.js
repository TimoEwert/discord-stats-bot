// database.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            joined_at TIMESTAMP NOT NULL,
            left_at TIMESTAMP NOT NULL,
            duration_seconds INT NOT NULL
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS channel_references (
            channel_id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL
        )
    `);
    console.log(`✅ [DB] PostgreSQL Datenbank & Tabellen erfolgreich initialisiert.`);
}

module.exports = { pool, initDatabase };
