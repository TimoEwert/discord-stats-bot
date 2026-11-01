// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    constructor() {
        this.name = "StatsManager";
    }

    async handleJoin(member) {
        if (!member || member.user.bot) return;

        // Wir merken uns nur noch den exakten Startzeitpunkt zur User-ID
        activeVoiceSessions.set(member.id, {
            joinedAt: new Date()
        });
    }

    async handleLeave(member) {
        if (!member || member.user.bot) return;
        const session = activeVoiceSessions.get(member.id);
        if (!session) return;

        const leaveTime = new Date();
        const durationSeconds = Math.floor((leaveTime - session.joinedAt) / 1000);
        const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60)); // Minutengenaue Abrechnung (mind. 1 Minute)

        if (durationSeconds > 10) { // Ignoriere ultra-kurze Micro-Joins unter 10 Sek.
            try {
                // Speicherung erfolgt nun strikt über die unveränderliche User-ID
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, joined_at, left_at, duration_seconds, duration_minutes) VALUES ($1, $2, $3, $4, $5)`,
                    [member.id, session.joinedAt, leaveTime, durationSeconds, durationMinutes]
                );
                console.log(`📊 [STATS] Voice-Session für User-ID ${member.id} gespeichert: ${durationMinutes} Minuten.`);
            } catch (err) {
                console.error('❌ [STATS ERROR] Fehler beim Speichern der Session:', err);
            }
        }
        activeVoiceSessions.delete(member.id);
    }
}

module.exports = new StatsManager();
