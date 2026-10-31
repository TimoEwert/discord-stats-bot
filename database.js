// database.js - Version 1.0 (Senior Programming Partner)
const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL-Verbindungspool initialisieren
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Datenbank-Tabellen automatisch anlegen, falls sie noch nicht existieren
const initDatabase = async () => {
  try {
    // Tabelle für Voice-Sessions (Start, Ende, Dauer)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(100) NOT NULL,
        joined_at TIMESTAMP NOT NULL,
        left_at TIMESTAMP,
        duration_seconds INT
      );
    `);

    // Tabelle für allgemeine Online-Präsenz (für den Discord-Online-Status)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS presence_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ PostgreSQL Datenbank erfolgreich verbunden & Tabellen geprüft.');
  } catch (error) {
    console.error('❌ Fehler beim Initialisieren der Datenbank:', error);
  }
};

module.exports = { pool, initDatabase };
