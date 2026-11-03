// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    constructor() {
        this.name = "StatsManager";
    }

    // Hilfsfunktion zur Ermittlung von ISO-Kalenderwoche, Jahr und formatiertem Datum (YYYY-MM-DD)
    getIsoWeekAndYear(date = new Date()) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        
        // Datum im Format YYYY-MM-DD für die Datenbank
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;

        return { year: d.getUTCFullYear(), week: weekNo, dateString };
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

            // Mitternachts-Splitting: Schneidet Sessions taggenau auf
            while (currentJoin < leaveTime) {
                const nextMidnight = new Date(currentJoin);
                nextMidnight.setHours(24, 0, 0, 0);

                let currentLeave = leaveTime < nextMidnight ? leaveTime : nextMidnight;

                const durationSeconds = Math.floor((currentLeave - currentJoin) / 1000);
                const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));

                if (durationSeconds > 10) {
                    const info = this.getIsoWeekAndYear(currentJoin);

                    // Sofort kumulativ in die Datenbank schreiben / addieren!
                    await pool.query(
                        `INSERT INTO user_time_stats (user_id, stat_date, calendar_week, year, total_minutes)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (user_id, stat_date)
                         DO UPDATE SET total_minutes = user_time_stats.total_minutes + EXCLUDED.total_minutes`,
                        [member.id, info.dateString, info.week, info.year, durationMinutes]
                    );

                    console.log(`📊 [STATS] Kumuliert für ${member.id} am ${info.dateString}: +${durationMinutes} Min.`);
                }

                currentJoin = nextMidnight;
            }
        } catch (err) {
            console.error('❌ [STATS ERROR] Fehler beim Speichern der kumulierten Session:', err);
        }
    }
}

module.exports = new StatsManager();
