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

    // Berechnet die Aktivitäts-Matrix und die echte Minutensumme für die aktuelle Woche
    async generateWeeklyHeatmapEmbed(guild, userId, targetDisplayName) {
        try {
            await pool.query("SET client_encoding = 'UTF8'");
            const res = await pool.query(
                `SELECT joined_at, left_at, duration_minutes FROM voice_sessions 
                 WHERE user_id = $1 
                   AND joined_at >= date_trunc('week', CURRENT_TIMESTAMP)`,
                [userId]
            );

            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle(`📊 WOCHEN-AKTIVITÄTSPROFIL: ${targetDisplayName}`)
                .setDescription(`Statistische Verteilung der Voice-Präsenz in 30-Minuten-Blöcken (Aktuelle Kalenderwoche)`)
                .setTimestamp();

            if (res.rows.length === 0) {
                embed.addFields({ 
                    name: 'Keine Daten in dieser Woche', 
                    value: 'Für diesen User wurden in dieser Kalenderwoche noch keine Voice-Zeiten erfasst.' 
                });
                return embed;
            }

            const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
            const weeklyMatrix = {};
            const weeklyMinutesPerDay = {}; // Speichert die echten Minuten pro Tag
            
            dayNames.forEach(d => {
                weeklyMatrix[d] = new Array(48).fill(0);
                weeklyMinutesPerDay[d] = 0;
            });

            for (const row of res.rows) {
                let start = new Date(row.joined_at);
                let end = new Date(row.left_at);
                let sessionDuration = row.duration_minutes || 0;

                // Ermittle den Wochentag des Session-Starts für die Minuten-Zuordnung
                let jsDay = start.getDay();
                let mappedDayIndex = jsDay === 0 ? 6 : jsDay - 1;
                weeklyMinutesPerDay[dayNames[mappedDayIndex]] += sessionDuration;

                // Raster-Aufteilung für die Visualisierung
                let current = new Date(start);
                while (current < end) {
                    let currJsDay = current.getDay();
                    let currMappedIndex = currJsDay === 0 ? 6 : currJsDay - 1;
                    let dayName = dayNames[currMappedIndex];

                    let hours = current.getHours();
                    let minutes = current.getMinutes();
                    let slotIndex = hours * 2 + (minutes >= 30 ? 1 : 0);

                    if (weeklyMatrix[dayName] && slotIndex >= 0 && slotIndex < 48) {
                        weeklyMatrix[dayName][slotIndex]++;
                    }

                    current.setTime(current.getTime() + 30 * 60 * 1000);
                }
            }

            let hasActivity = false;
            for (const day of dayNames) {
                const slots = weeklyMatrix[day];
                const activeSlotsCount = slots.filter(val => val > 0).length;
                const totalMinutesForDay = weeklyMinutesPerDay[day];

                if (activeSlotsCount > 0) {
                    hasActivity = true;
                    
                    let timeLines = [];
                    let rangeStart = null;
                    for (let i = 0; i <= 48; i++) {
                        let isActive = i < 48 && slots[i] > 0;
                        if (isActive && rangeStart === null) {
                            rangeStart = i;
                        } else if (!isActive && rangeStart !== null) {
                            let startHour = Math.floor(rangeStart / 2).toString().padStart(2, '0');
                            let startMin = (rangeStart % 2 === 0) ? '00' : '30';
                            let endHour = Math.floor(i / 2).toString().padStart(2, '0');
                            let endMin = (i % 2 === 0) ? '00' : '30';
                            
                            timeLines.push(`• ${startHour}:${startMin} - ${endHour}:${endMin} Uhr`);
                            rangeStart = null;
                        }
                    }

                    let barLength = Math.min(10, Math.ceil((activeSlotsCount / 48) * 10));
                    let bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);

                    // Zeigt nun die exakte Minutensumme aus der DB anstelle von (Slots * 30)
                    embed.addFields({
                        name: `📅 ${day}`,
                        value: `[${bar}] ${totalMinutesForDay} Min. aktiv\n${timeLines.slice(0, 3).join('\n')}`,
                        inline: false
                    });
                }
            }

            if (!hasActivity) {
                embed.addFields({ name: 'Keine Aktivität', value: 'In dieser Woche wurden noch keine aktiven Blöcke aufgezeichnet.' });
            }

            return embed;

        } catch (err) {
            console.error('❌ [STATS ANALYSIS ERROR]:', err);
            throw err;
        }
    }
}

module.exports = new StatsAnalysisManager();
