// managers/statsPost.js
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../database');
const cron = require('node-cron');

const getStatsChannelIds = () => {
    const raw = process.env.STATS_CHANNEL_ID || 'DEINE_CHANNEL_ID_HIER';
    return raw.split(',').map(id => id.trim()).filter(id => id.length > 0);
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

            const res = await pool.query(
                `SELECT user_id, joined_at, left_at, duration_minutes 
                 FROM voice_sessions 
                 ORDER BY joined_at ASC`
            );

            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle(`📜 WÖCHENTLICHER VOICE-RÜCKBLICK`)
                .setDescription(`Detaillierte Übersicht aller Sprachkanal-Aktivitäten der vergangenen Woche\n──────────────────────────────`)
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

                    // Nach jedem User (außer dem letzten) eine schicke Trennlinie hinzufügen
                    if (index < entries.length - 1) {
                        detailsText += `\n──────────────────────────────`;
                    }

                    embed.addFields({
                        name: `👤 ${displayName} — Gesamt: ${h}h ${m}m`,
                        value: detailsText || 'Keine Intervalle',
                        inline: false
                    });
                }
            }

            for (const channel of targetChannels) {
                await channel.send({ embeds: [embed] }).catch(err => {
                    console.error(`❌ [StatsPostManager] Konnte Nachricht nicht in Channel ${channel.id} senden:`, err);
                });
            }

            console.log(`✅ [StatsPostManager] Wöchentlicher Rückblick erfolgreich an ${targetChannels.length} Kanal/Kanäle gesendet.`);
            return true;

        } catch (err) {
            console.error('❌ [StatsPostManager] Fehler beim Posten der Wochenstatistik:', err);
            return false;
        }
    }
}

module.exports = new StatsPostManager();
