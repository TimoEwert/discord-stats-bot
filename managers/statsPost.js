// managers/statsPost.js
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../database');
const cron = require('node-cron');

// HIER DEINE CHANNEL-ID EINTRAGEN (oder über process.env.STATS_CHANNEL_ID steuern):
const STATS_CHANNEL_ID = process.env.STATS_CHANNEL_ID || 'deine channelid hier';

class StatsPostManager {
    constructor() {
        this.name = "StatsPostManager";
    }

    /**
     * Startet den automatischen Cronjob für Sonntag 23:45 Uhr
     */
    initCron(client) {
        // Cron-Syntax: 45 (Minute) 23 (Stunde) * (Jeder Tag) * (Jeder Monat) 0 (Sonntag)
        cron.schedule('45 23 * * 0', async () => {
            console.log('⏰ [CRON] Starte wöchentlichen Voice-Stats Rückblick...');
            await this.postWeeklyDetailedStats(client);
        });
        console.log('✅ [StatsPostManager] Wöchentlicher Cronjob (Sonntag 23:45 Uhr) wurde erfolgreich registriert.');
    }

    /**
     * Holt die detaillierten Rohdaten aus voice_sessions und sendet das Embed
     */
    async postWeeklyDetailedStats(client, customChannel = null) {
        try {
            await pool.query("SET client_encoding = 'UTF8'");

            const channelId = customChannel ? customChannel.id : STATS_CHANNEL_ID;
            const targetChannel = customChannel || await client.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) {
                console.error(`❌ [StatsPostManager] Channel mit ID "${channelId}" konnte nicht gefunden werden!`);
                return false;
            }

            // Alle Sessions der aktuellen Woche aus voice_sessions abfragen
            const res = await pool.query(
                `SELECT user_id, joined_at, left_at, duration_minutes 
                 FROM voice_sessions 
                 ORDER BY joined_at ASC`
            );

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`📜 WÖCHENTLICHER VOICE-RÜCKBLICK`)
                .setDescription(`Detaillierte Übersicht aller Sprachkanal-Aktivitäten der vergangenen Woche`)
                .setTimestamp();

            if (res.rows.length === 0) {
                embed.addFields({ 
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

                for (const [userId, data] of Object.entries(userMap)) {
                    let displayName = `User ID: ${userId}`;
                    try {
                        const guild = targetChannel.guild;
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

                    if (detailsText.length > 1000) {
                        detailsText = detailsText.substring(0, 950) + '\n... (weitere Intervalle gekürzt)';
                    }

                    embed.addFields({
                        name: `👤 ${displayName} — Gesamt: ${h}h ${m}m`,
                        value: detailsText || 'Keine Intervalle',
                        inline: false
                    });
                }
            }

            await targetChannel.send({ embeds: [embed] });
            console.log(`✅ [StatsPostManager] Wöchentlicher Rückblick erfolgreich gepostet.`);
            return true;

        } catch (err) {
            console.error('❌ [StatsPostManager] Fehler beim Posten der Wochenstatistik:', err);
            return false;
        }
    }
}

module.exports = new StatsPostManager();
