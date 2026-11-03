// database.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    options: '-c client_encoding=UTF8'
});

async function initDatabase() {
    // 1. Live-Puffer für die aktuelle Woche (minutengenau)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            joined_at TIMESTAMP NOT NULL,
            left_at TIMESTAMP NOT NULL,
            duration_seconds INT NOT NULL,
            duration_minutes INT DEFAULT 0
        )
    `);
    
    // 2. Kanal-Referenzen für den visuellen Manager
    await pool.query(`
        CREATE TABLE IF NOT EXISTS channel_references (
            channel_id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            current_display_name TEXT,
            is_alert_active BOOLEAN DEFAULT FALSE
        )
    `);

    // 3. NEU: Wöchentliche Gesamtsummen (pro User, Jahr und Kalenderwoche)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS week_times (
            user_id TEXT NOT NULL,
            year INT NOT NULL,
            calendar_week INT NOT NULL,
            total_minutes INT NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, year, calendar_week)
        )
    `);

    // 4. NEU: Jährliche Gesamtsummen (pro User und Jahr)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS year_times (
            user_id TEXT NOT NULL,
            year INT NOT NULL,
            total_minutes INT NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, year)
        )
    `);

    // Indizes für maximale Performance bei Abfragen
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_week_times_user ON week_times (user_id, year, calendar_week)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_year_times_user ON year_times (user_id, year)`);

    console.log(`✅ [DB] PostgreSQL Datenbank & alle Tabellen (inkl. week_times & year_times) erfolgreich initialisiert.`);
}

module.exports = { pool, initDatabase };
