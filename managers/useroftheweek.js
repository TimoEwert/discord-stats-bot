// managers/useroftheweek.js
const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const cron = require('node-cron');

const DATA_FILE = path.join(__dirname, '../data/current_king.json');
const KING_EMOJI = '👑 ';

class UserOfTheWeekManager {
    constructor() {
        this.name = "UserOfTheWeekManager";
        this.ensureDataFileExists();
    }

    ensureDataFileExists() {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify({
                kingUserId: null,
                originalNickname: null,
                updatedAt: null
            }, null, 2));
        }
    }

    getKingData() {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(raw);
        } catch (e) {
            return { kingUserId: null, originalNickname: null, updatedAt: null };
        }
    }

    saveKingData(kingUserId, originalNickname) {
        const data = {
            kingUserId,
            originalNickname,
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }

    initCron(guild) {
        cron.schedule('50 23 * * 0', async () => {
            console.log('⏰ [CRON] Starte Auswertung des Königs der Woche...');
            await this.updateKingOfWeek(guild);
        });
        console.log('✅ [UserOfTheWeekManager] Wöchentlicher Cronjob (Sonntag 23:50 Uhr) wurde erfolgreich registriert.');
    }

    async updateKingOfWeek(guild) {
        try {
            await pool.query("SET client_encoding = 'UTF8'");

            // Aktivsten User aus user_time_stats ermitteln
            const res = await pool.query(`
                SELECT user_id, SUM(total_minutes) as total_mins
                FROM user_time_stats
                WHERE year = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
                  AND calendar_week = EXTRACT(WEEK FROM CURRENT_TIMESTAMP)
                GROUP BY user_id
                ORDER BY total_mins DESC
                LIMIT 1
            `);

            if (res.rows.length === 0) {
                console.log('⚠️ [UserOfTheWeekManager] Keine Sprachzeitdaten für diese Woche vorhanden.');
                return false;
            }

            const newKingId = res.rows[0].user_id;
            const currentKingData = this.getKingData();

            if (currentKingData.kingUserId === newKingId) {
                console.log(`👑 [UserOfTheWeekManager] User <@${newKingId}> bleibt weiterhin König der Woche!`);
                return true;
            }

            // Alten König entthronen
            if (currentKingData.kingUserId) {
                const oldMember = await guild.members.fetch(currentKingData.kingUserId).catch(() => null);
                if (oldMember) {
                    try {
                        const restoredName = currentKingData.originalNickname || oldMember.displayName.replace(KING_EMOJI, '').trim();
                        await oldMember.setNickname(restoredName);
                        console.log(`🗡️ [UserOfTheWeekManager] Entthront: ${oldMember.user.tag} -> "${restoredName}"`);
                    } catch (err) {
                        console.error(`❌ [UserOfTheWeekManager] Konnte Nickname von altem König nicht zurücksetzen:`, err.message);
                    }
                }
            }

            // Neuen König krönen
            const newMember = await guild.members.fetch(newKingId).catch(() => null);
            if (!newMember) {
                console.error(`❌ [UserOfTheWeekManager] Neuer König ID ${newKingId} nicht auf dem Server gefunden.`);
                return false;
            }

            const originalNick = newMember.nickname || newMember.user.username;
            const crownedNick = `${KING_EMOJI}${originalNick}`;

            try {
                await newMember.setNickname(crownedNick);
                console.log(`👑 [UserOfTheWeekManager] Gekrönt: ${newMember.user.tag} -> "${crownedNick}"`);
            } catch (err) {
                console.error(`❌ [UserOfTheWeekManager] Konnte Nickname für neuen König nicht ändern (Rechte prüfen):`, err.message);
            }

            this.saveKingData(newKingId, originalNick);
            return { newKingId, originalNick, crownedNick };

        } catch (err) {
            console.error('❌ [UserOfTheWeekManager] Fehler beim Aktualisieren des Königs der Woche:', err);
            return false;
        }
    }
}

module.exports = new UserOfTheWeekManager();
