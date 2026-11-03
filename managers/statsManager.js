// managers/statsManager.js
const { pool } = require('../database');
const activeVoiceSessions = new Map();

class StatsManager {
    constructor() {
        this.name = "StatsManager";
        this.lastCheckedWeek = null;
        this.lastCheckedYear = null;
    }

    // Initialisiert den Hintergrund-Check (wird einmalig beim Bot-Start aufgerufen)
    initPeriodicCheck() {
        console.log("⏰ [STATS] Starte periodischen Perioden-Überwachungsdienst (Stündlicher Check)...");
        
        // Sofort beim Start einmal prüfen
        this.checkAndProcessPeriodChange();

        // Danach stündlich prüfen (60 Minuten = 3600000 ms)
        setInterval(() => {
            this.checkAndProcessPeriodChange();
        }, 3600000);
    }

    // Hilfsfunktion zur Ermittlung von ISO-Kalenderwoche und Jahr
    getIsoWeekAndYear(date = new Date()) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return { year: d.getUTCFullYear(), week: weekNo };
    }

    // Kernlogik: Prüft, ob eine neue Woche oder ein neues Jahr begonnen hat
    async checkAndProcessPeriodChange() {
        try {
            await pool.query("SET client_encoding = 'UTF8'");
            const now = new Date();
            const current = this.getIsoWeekAndYear(now);
            const currentYear = now.getFullYear();

            // 1. Prüfe auf Jahreswechsel (Jahresende-Abrechnung)
            // Wir prüfen, ob es in voice_sessions noch Einträge aus vergangenen Jahren gibt 
            // oder ob sich das Jahr geändert hat.
            const yearCheck = await pool.query(
                `SELECT DISTINCT EXTRACT(YEAR FROM joined_at)::int as session_year 
                 FROM voice_sessions 
                 WHERE EXTRACT(YEAR FROM joined_at)::int < $1`,
                [currentYear]
            );

            if (yearCheck.rows.length > 0) {
                console.log("🏆 [YEAR-END] Jahreswechsel erkannt! Starte Jahres-Aggregation...");
                
                for (const row of yearCheck.rows) {
                    const oldYear = row.session_year;

                    // A) Daten in year_times schreiben / updaten
                    await pool.query(
                        `INSERT INTO year_times (user_id, year, total_minutes)
                         SELECT user_id, $1, SUM(duration_minutes)
                         FROM voice_sessions
                         WHERE EXTRACT(YEAR FROM joined_at)::int = $1
                         GROUP BY user_id
                         ON CONFLICT (user_id, year)
                         DO UPDATE SET total_minutes = year_times.total_minutes + EXCLUDED.total_minutes`,
                        [oldYear]
                    );

                    // B) Auch sicherstellen, dass die week_times für das alte Jahr sauber sind
                    await pool.query(
                        `INSERT INTO week_times (user_id, year, calendar_week, total_minutes)
                         SELECT user_id, EXTRACT(YEAR FROM joined_at)::int, EXTRACT(WEEK FROM joined_at)::int, SUM(duration_minutes)
                         FROM voice_sessions
                         WHERE EXTRACT(YEAR FROM joined_at)::int = $1
                         GROUP BY user_id, year, calendar_week
                         ON CONFLICT (user_id, year, calendar_week)
                         DO UPDATE SET total_minutes = week_times.total_minutes + EXCLUDED.total_minutes`,
                        [oldYear]
                    );
                }

                console.log("✅ [YEAR-END] Jahres-Aggregation erfolgreich abgeschlossen.");
            }

            // 2. Prüfe auf Wochenwechsel (Wochen-Abrechnung)
            // Wir prüfen, ob es in voice_sessions Einträge gibt, die nicht zur aktuellen Kalenderwoche gehören
            const weekCheck = await pool.query(
                `SELECT DISTINCT EXTRACT(YEAR FROM joined_at)::int as yr, EXTRACT(WEEK FROM joined_at)::int as cw
                 FROM voice_sessions
                 WHERE (EXTRACT(YEAR FROM joined_at)::int < $1) OR (EXTRACT(WEEK FROM joined_at)::int < $2)`,
                [current.year, current.week]
            );

            if (weekCheck.rows.length > 0) {
                console.log("📊 [WEEK-CHANGE] Neuer Wochenwechsel erkannt! Aggregiere vergangene Wochen...");

                // A) Laufende activeVoiceSessions kurz einfrieren/beenden, damit keine ungespeicherten Daten verloren gehen
                // (Optional: Aktive Sessions werden beim Leave ohnehin sauber behandelt, aber für den Schnitt gut zu wissen)

                // B) Vergangene Wochen in week_times übertragen
                await pool.query(
                    `INSERT INTO week_times (user_id, year, calendar_week, total_minutes)
                     SELECT user_id, EXTRACT(YEAR FROM joined_at)::int, EXTRACT(WEEK FROM joined_at)::int, SUM(duration_minutes)
                     FROM voice_sessions
                     WHERE (EXTRACT(YEAR FROM joined_at)::int < $1) OR (EXTRACT(YEAR FROM joined_at)::int = $1 AND EXTRACT(WEEK FROM joined_at)::int < $2)
                     GROUP BY user_id, year, calendar_week
                     ON CONFLICT (user_id, year, calendar_week)
                     DO UPDATE SET total_minutes = week_times.total_minutes + EXCLUDED.total_minutes`,
                    [current.year, current.week]
                );

                // C) voice_sessions bereinigen (nur die alten Einträge löschen, die jetzt aggregiert wurden)
                await pool.query(
                    `DELETE FROM voice_sessions 
                     WHERE (EXTRACT(YEAR FROM joined_at)::int < $1) OR (EXTRACT(YEAR FROM joined_at)::int = $1 AND EXTRACT(WEEK FROM joined_at)::int < $2)`,
                    [current.year, current.week]
                );

                console.log("✅ [WEEK-CHANGE] Wochen-Aggregation und Bereinigung der voice_sessions erfolgreich durchgeführt.");
            }

        } catch (err) {
            console.error("❌ [STATS ERROR] Fehler beim periodischen Perioden-Check:", err);
        }
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
                nextMidnight.setHours(24, 0, 0, 0);

                let currentLeave = leaveTime < nextMidnight ? leaveTime : nextMidnight;

                const durationSeconds = Math.floor((currentLeave - currentJoin) / 1000);
                const durationMinutes = Math.max(1, Math.floor(durationSeconds / 60));

                if (durationSeconds > 10) {
                    await pool.query(
                        `INSERT INTO voice_sessions (user_id, joined_at, left_at, duration_seconds, duration_minutes) VALUES ($1, $2, $3, $4, $5)`,
                        [member.id, currentJoin, currentLeave, durationSeconds, durationMinutes]
                    );
                }

                currentJoin = nextMidnight;
            }
        } catch (err) {
            console.error('❌ [STATS ERROR] Fehler beim Mitternachts-Splitting der Session:', err);
        }
    }
}

module.exports = new StatsManager();
