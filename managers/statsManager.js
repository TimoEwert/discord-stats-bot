// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    handleJoin(userId, username) {
        activeVoiceSessions.set(userId, new Date());
    }

    async handleLeave(userId, username) {
        const joinTime = activeVoiceSessions.get(userId);
        if (!joinTime) return;

        const leaveTime = new Date();
        const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);

        if (durationSeconds > 0) {
            try {
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                    [userId, username, joinTime, leaveTime, durationSeconds]
                );
                console.log(`💾 [STATS] Session gespeichert für ${username}: ${durationSeconds}s`);
            } catch (err) {
                console.error('❌ [STATS ERROR] Fehler beim Speichern der Session:', err);
            }
        }
        activeVoiceSessions.delete(userId);
    }
}

module.exports = new StatsManager();
