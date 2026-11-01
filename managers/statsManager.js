// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    constructor() {
        this.name = "StatsManager";
    }

    handleJoin(member) {
        activeVoiceSessions.set(member.id, new Date());
    }

    async handleLeave(member) {
        const joinTime = activeVoiceSessions.get(member.id);
        if (!joinTime) return;

        const leaveTime = new Date();
        const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);

        if (durationSeconds > 0) {
            try {
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                    [member.id, member.user.tag, joinTime, leaveTime, durationSeconds]
                );
            } catch (err) {
                console.error('❌ [STATS ERROR] Fehler beim Speichern der Session:', err);
            }
        }
        activeVoiceSessions.delete(member.id);
    }
}

module.exports = new StatsManager();
