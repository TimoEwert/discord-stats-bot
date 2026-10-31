// database.js - Version 2.0 (Senior Programming Partner)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDatabase = async () => {
  try {
    // Tabelle für Voice-Sessions
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

    // Tabelle für die in der Datenbank gespeicherten Klassen der User
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_classes (
        user_id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) NOT NULL,
        class_name VARCHAR(50) NOT NULL,
        icon VARCHAR(10) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ PostgreSQL Datenbank erfolgreich verbunden & Tabellen (Voice + Klassen) geprüft.');
  } catch (error) {
    console.error('❌ Fehler beim Initialisieren der Datenbank:', error);
  }
};

module.exports = { pool, initDatabase };
