// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    constructor() {
        this.name = "StatsManager";
    }

    async handleJoin(member) {
        if (!member || member.user.bot) return;
        activeVoiceSessions.set(member.id, {
            joinedAt: new Date(),
            username: member.user.username // Stabiler Basis-Profilname für die DB
        });
    }

    async handleLeave(member) {
        if (!member || member.user.bot) return;
        const session = activeVoiceSessions.get(member.id);
        if (!session) return;

        const leaveTime = new Date();
        const durationSeconds = Math.floor((leaveTime - session.joinedAt) / 1000);
        const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60)); // Minutengenaue Abrechnung (mind. 1 Minute bei Test)

        if (durationSeconds > 10) { // Ignoriere ultra-kurze Micro-Joins unter 10 Sek.
            try {
                // Tabelle auf Minuten-Abrechnung ausgelegt
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [member.id, session.username, session.joinedAt, leaveTime, durationSeconds, durationMinutes]
                );
                console.log(`📊 [STATS] Voice-Session für ${session.username} gespeichert: ${durationMinutes} Minuten.`);
            } catch (err) {
                console.error('❌ [STATS ERROR] Fehler beim Speichern der Session:', err);
            }
        }
        activeVoiceSessions.delete(member.id);
    }
}

module.exports = new StatsManager();
