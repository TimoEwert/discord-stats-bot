// database.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    options: '-c client_encoding=UTF8'
});

async function initDatabase() {
    // 1. Zentrale kumulative Statistik-Tabelle (Tag-, Wochen- und Monatsgenau)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_time_stats (
            user_id TEXT NOT NULL,
            stat_date DATE NOT NULL,
            calendar_week INT NOT NULL,
            year INT NOT NULL,
            total_minutes INT NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, stat_date)
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

    // Performance-Index für blitzschnelle Abfragen nach User, Jahr, KW und Datum
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_time_stats_lookup ON user_time_stats (user_id, year, calendar_week, stat_date)`);

    console.log(`✅ [DB] PostgreSQL Datenbank & kumulative Tabelle (user_time_stats) erfolgreich initialisiert.`);
}

module.exports = { pool, initDatabase };
