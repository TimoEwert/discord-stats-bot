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
            joinedAt: new Date()
        });
    }

    async handleLeave(member) {
        if (!member || member.user.bot) return;
        const session = activeVoiceSessions.get(member.id);
        if (!session) return;

        const leaveTime = new Date();
        let currentJoin = new Date(session.joinedAt);

        activeVoiceSessions.delete(member.id);

        try {
            await pool.query("SET client_encoding = 'UTF8'");

            // Mitternachts-Splitting: Schleife bricht lange Sessions taggenau auf
            while (currentJoin < leaveTime) {
                const nextMidnight = new Date(currentJoin);
                nextMidnight.setHours(24, 0, 0, 0); // 00:00:00 des Folgetages

                let currentLeave = leaveTime < nextMidnight ? leaveTime : nextMidnight;

                const durationSeconds = Math.floor((currentLeave - currentJoin) / 1000);
                const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));

                if (durationSeconds > 10) { // Ignoriere Micro-Joins unter 10 Sek.
                    await pool.query(
                        `INSERT INTO voice_sessions (user_id, joined_at, left_at, duration_seconds, duration_minutes) VALUES ($1, $2, $3, $4, $5)`,
                        [member.id, currentJoin, currentLeave, durationSeconds, durationMinutes]
                    );
                    console.log(`📊 [STATS] Voice-Session Segment für ${member.id} gespeichert: ${currentJoin.toISOString()} bis ${currentLeave.toISOString()} (${durationMinutes} Min.)`);
                }

                currentJoin = nextMidnight;
            }
        } catch (err) {
            console.error('❌ [STATS ERROR] Fehler beim Mitternachts-Splitting der Session:', err);
        }
    }
}

module.exports = new StatsManager();
