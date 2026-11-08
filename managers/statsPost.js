// managers/statsPost.js
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../database');
const cron = require('node-cron');

const getStatsChannelIds = () => {
    const raw = process.env.STATS_CHANNEL_ID || 'DEINE_CHANNEL_ID_HIER';
    return raw.split(',').map(id => id.trim()).filter(id => id.length > 0);
};

// Hilfsfunktion zur Ermittlung der aktuellen Kalenderwoche
const getCurrentCalendarWeek = () => {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
};

class StatsPostManager {
    constructor() {
        this.name = "StatsPostManager";
    }

    initCron(client) {
        cron.schedule('45 23 * * 0', async () => {
            console.log('⏰ [CRON] Starte wöchentlichen Voice-Stats Rückblick...');
            await this.postWeeklyDetailedStats(client);
        });
        console.log('✅ [StatsPostManager] Wöchentlicher Cronjob (Sonntag 23:45 Uhr) wurde erfolgreich registriert.');
    }

    async postWeeklyDetailedStats(client, customChannel = null) {
        try {
            await pool.query("SET client_encoding = 'UTF8'");

            let targetChannels = [];
            if (customChannel) {
                targetChannels = [customChannel];
            } else {
                const ids = getStatsChannelIds();
                for (const id of ids) {
                    const ch = await client.channels.fetch(id).catch(() => null);
                    if (ch) targetChannels.push(ch);
                    else console.error(`❌ [StatsPostManager] Channel mit ID "${id}" konnte nicht gefunden werden!`);
                }
            }

            if (targetChannels.length === 0) {
                console.error(`❌ [StatsPostManager] Keine gültigen Ziel-Channels für den Wochen-Rückblick gefunden!`);
                return false;
            }

            const currentKW = getCurrentCalendarWeek();

            const res = await pool.query(
                `SELECT user_id, joined_at, left_at, duration_minutes 
                 FROM voice_sessions 
                 ORDER BY joined_at ASC`
            );

            const fields = [];

            if (res.rows.length === 0) {
                fields.push({ 
                    name: 'Keine Aktivität', 
                    value: 'In dieser Woche wurden keine detaillierten Voice-Sessions aufgezeichnet.' 
                });
            } else {
                const userMap = {};

                for (const row of res.rows) {
                    const userId = row.user_id;
                    const dateObj = new Date(row.joined_at);
                    
                    const dayFormatted = dateObj.toLocaleDateString('de-DE', { 
                        weekday: 'long', 
                        day: '2-digit', 
                        month: '2-digit' 
                    });

                    const timeFrom = dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                    const timeTo = new Date(row.left_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

                    if (!userMap[userId]) {
                        userMap[userId] = { totalMinutes: 0, days: {} };
                    }

                    userMap[userId].totalMinutes += row.duration_minutes;

                    if (!userMap[userId].days[dayFormatted]) {
                        userMap[userId].days[dayFormatted] = [];
                    }

                    userMap[userId].days[dayFormatted].push(`${timeFrom} - ${timeTo} Uhr (${row.duration_minutes} Min.)`);
                }

                const entries = Object.entries(userMap);
                for (let index = 0; index < entries.length; index++) {
                    const [userId, data] = entries[index];

                    let displayName = `User ID: ${userId}`;
                    try {
                        const guild = targetChannels[0].guild;
                        if (guild) {
                            const member = await guild.members.fetch(userId).catch(() => null);
                            if (member) {
                                displayName = member.displayName
                                    .replace(/^[🔴⚠️.]+/g, '')
                                    .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱👑]+/g, '')
                                    .trim();
                            }
                        }
                    } catch (e) {}

                    const h = Math.floor(data.totalMinutes / 60);
                    const m = data.totalMinutes % 60;

                    let detailsText = '';
                    for (const [day, intervals] of Object.entries(data.days)) {
                        detailsText += `📅 **${day}**\n`;
                        detailsText += intervals.map(i => `  • ${i}`).join('\n') + '\n';
                    }

                    if (detailsText.length > 900) {
                        detailsText = detailsText.substring(0, 850) + '\n... (weitere Intervalle gekürzt)';
                    }

                    if (index < entries.length - 1) {
                        detailsText += `\n──────────────────────────────`;
                    }

                    fields.push({
                        name: `👤 ${displayName} — Gesamt: ${h}h ${m}m (KW ${currentKW})`,
                        value: detailsText || 'Keine Intervalle',
                        inline: false
                    });
                }
            }

            // Felder in Häppchen von max. 5 Usern pro Nachricht aufteilen, um das 6000-Zeichen-Limit zu umgehen
            const chunkSize = 5;
            const chunkedFields = [];
            for (let i = 0; i < fields.length; i += chunkSize) {
                chunkedFields.push(fields.slice(i, i + chunkSize));
            }

            const messagesToSend = chunkedFields.map((chunk, chunkIndex) => {
                const embed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setTitle(chunkIndex === 0 ? `📜 WÖCHENTLICHER VOICE-RÜCKBLICK (KW ${currentKW})` : `📜 WÖCHENTLICHER VOICE-RÜCKBLICK (KW ${currentKW}) — Teil ${chunkIndex + 1}`)
                    .setDescription(chunkIndex === 0 ? `Detaillierte Übersicht aller Sprachkanal-Aktivitäten der vergangenen Woche\n──────────────────────────────` : `──────────────────────────────`)
                    .setTimestamp();

                embed.addFields(chunk);
                return { embeds: [embed] };
            });

            // An alle Ziel-Kanäle senden (mit 1 Sekunde Abstand zwischen den Teilstücken)
            for (const channel of targetChannels) {
                for (const msgPayload of messagesToSend) {
                    await channel.send(msgPayload).catch(err => {
                        console.error(`❌ [StatsPostManager] Konnte Nachricht nicht in Channel ${channel.id} senden:`, err);
                    });
                    // 1 Sekunde Pause zwischen den Nachrichten einhalten
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            console.log(`✅ [StatsPostManager] Wöchentlicher Rückblick erfolgreich in ${messagesToSend.length} Teilen an ${targetChannels.length} Kanal/Kanäle gesendet.`);
            return true;

        } catch (err) {
            console.error('❌ [StatsPostManager] Fehler beim Posten der Wochenstatistik:', err);
            return false;
        }
    }
}

module.exports = new StatsPostManager();
