// database.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    // Erzwinge UTF-8 für Emojis und Sonderzeichen
    options: '-c client_encoding=UTF8'
});

async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            joined_at TIMESTAMP NOT NULL,
            left_at TIMESTAMP NOT NULL,
            duration_seconds INT NOT NULL,
            duration_minutes INT DEFAULT 0
        )
    `);
    
    await pool.query(`
        CREATE TABLE IF NOT EXISTS channel_references (
            channel_id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            current_display_name TEXT,
            is_alert_active BOOLEAN DEFAULT FALSE
        )
    `);
    console.log(`✅ [DB] PostgreSQL Datenbank & Tabellen erfolgreich initialisiert (UTF-8 aktiv).`);
}

module.exports = { pool, initDatabase };
