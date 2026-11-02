// managers/statsAnalysisManager.js
const { EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const { pool } = require('../database');

class StatsAnalysisManager {
    constructor() {
        this.name = "StatsAnalysisManager";
    }

    // Sendet das Dropdown-Menü öffentlich in den Channel
    async sendSelectMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_wochen_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Wochen-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '📊 Bitte wähle das gewünschte Mitglied aus der Liste aus:',
            components: [row]
        });
    }

    // Verarbeitet die Auswahl aus dem Dropdown und sendet das Ergebnis öffentlich
    async handleSelectMenu(interaction) {
        await interaction.deferUpdate();
        
        const selectedUserId = interaction.values[0];
        
        try {
            const targetMember = await interaction.guild.members.fetch(selectedUserId).catch(() => null);

            if (!targetMember) {
                await interaction.editReply({ content: `❌ Das ausgewählte Mitglied konnte nicht gefunden werden.`, components: [], embeds: [] });
                return;
            }

            let cleanDisplayName = targetMember.displayName
                .replace(/^[🔴⚠️.]+/g, '')
                .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '')
                .trim();

            const embed = await this.generateWeeklyHeatmapEmbed(
                interaction.guild, 
                targetMember.id, 
                cleanDisplayName
            );

            await interaction.editReply({ 
                content: `📊 Wochen-Aktivitätsstatistik für **${cleanDisplayName}** (angefordert von <@${interaction.user.id}>):`, 
                embeds: [embed], 
                components: [] 
            });

        } catch (err) {
            console.error("❌ [SELECT MENU ERROR]:", err);
            await interaction.editReply({ content: `❌ Ein Fehler ist bei der Auswertung aufgetreten: ${err.message}`, components: [], embeds: [] });
        }
    }

    // Berechnet die minutengenaue Übersicht für die aktuelle Woche eines Users
    async generateWeeklyHeatmapEmbed(guild, userId, targetDisplayName) {
        try {
            await pool.query("SET client_encoding = 'UTF8'");
            const res = await pool.query(
                `SELECT joined_at, left_at, duration_minutes FROM voice_sessions 
                 WHERE user_id = $1 
                   AND joined_at >= date_trunc('week', CURRENT_TIMESTAMP)
                 ORDER BY joined_at ASC`,
                [userId]
            );

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`📊 WOCHEN-AKTIVITÄTSPROFIL: ${targetDisplayName}`)
                .setDescription(`Minutengenaue Übersicht der Voice-Präsenz (Aktuelle Kalenderwoche)`)
                .setTimestamp();

            if (res.rows.length === 0) {
                embed.addFields({ 
                    name: 'Keine Daten in dieser Woche', 
                    value: 'Für diesen User wurden in dieser Kalenderwoche noch keine Voice-Zeiten erfasst.' 
                });
                return embed;
            }

            const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
            const sessionsPerDay = {};
            const totalMinutesPerDay = {};

            dayNames.forEach(d => {
                sessionsPerDay[d] = [];
                totalMinutesPerDay[d] = 0;
            });

            // Ordne jede Session dem jeweiligen Wochentag zu
            for (const row of res.rows) {
                let start = new Date(row.joined_at);
                let end = new Date(row.left_at);
                let duration = row.duration_minutes || 0;

                let jsDay = start.getDay();
                let mappedDayIndex = jsDay === 0 ? 6 : jsDay - 1;
                let dayName = dayNames[mappedDayIndex];

                // Formatiere Uhrzeiten (HH:MM)
                let startTime = start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
                let endTime = end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

                sessionsPerDay[dayName].push(`• ${startTime} - ${endTime} Uhr (${duration} Min.)`);
                totalMinutesPerDay[dayName] += duration;
            }

            let hasActivity = false;
            for (const day of dayNames) {
                const sessions = sessionsPerDay[day];
                const totalMinutes = totalMinutesPerDay[day];

                if (sessions.length > 0) {
                    hasActivity = true;

                    embed.addFields({
                        name: `📅 ${day} — Total: ${totalMinutes} Min.`,
                        value: sessions.join('\n'),
                        inline: false
                    });
                }
            }

            if (!hasActivity) {
                embed.addFields({ name: 'Keine Aktivität', value: 'In dieser Woche wurden noch keine Sessions aufgezeichnet.' });
            }

            return embed;

        } catch (err) {
            console.error('❌ [STATS ANALYSIS ERROR]:', err);
            throw err;
        }
    }
}

module.exports = new StatsAnalysisManager();
