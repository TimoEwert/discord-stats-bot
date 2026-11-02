// managers/statsAnalysisManager.js
const { EmbedBuilder } = require('discord.js');
const { pool } = require('../database');

class StatsAnalysisManager {
    constructor() {
        this.name = "StatsAnalysisManager";
    }

    // Hilfsfunktion: Berechnet die Aktivitäts-Matrix für die aktuelle Woche eines Users
    async generateWeeklyHeatmapEmbed(guild, userId, targetDisplayName) {
        try {
            // 1. Hole alle Voice-Sessions des Users für die laufende Woche (ab Montag 00:00 Uhr)
            await pool.query("SET client_encoding = 'UTF8'");
            const res = await pool.query(
                `SELECT joined_at, left_at FROM voice_sessions 
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

            // 2. Initialisiere ein Raster für Wochentage (1 = Montag bis 7 = Sonntag) und 30-Minuten-Slots (0 bis 47)
            // Wochentag in JS: 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa -> Wir mappen das sauber auf Mo-So.
            const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
            const weeklyMatrix = {};
            dayNames.forEach(d => {
                weeklyMatrix[d] = new Array(48).fill(0); // 48 Blöcke à 30 Minuten am Tag
            });

            // 3. Jede Session in die 30-Minuten-Slots aufteilen
            for (const row of res.rows) {
                let start = new Date(row.joined_at);
                let end = new Date(row.left_at);

                // Iteriere minutengenau oder in 30-Minuten-Schritten durch die Session
                let current = new Date(start);
                while (current < end) {
                    // Wochentag ermitteln (JS getDay(): 0=So, 1=Mo ...)
                    let jsDay = current.getDay();
                    let mappedDayIndex = jsDay === 0 ? 6 : jsDay - 1; // Mo=0 ... So=6
                    let dayName = dayNames[mappedDayIndex];

                    // Slot des Tages berechnen (0 bis 47)
                    let hours = current.getHours();
                    let minutes = current.getMinutes();
                    let slotIndex = hours * 2 + (minutes >= 30 ? 1 : 0);

                    if (weeklyMatrix[dayName] && slotIndex >= 0 && slotIndex < 48) {
                        weeklyMatrix[dayName][slotIndex]++;
                    }

                    // 30 Minuten weitergehen
                    current.setTime(current.getTime() + 30 * 60 * 1000);
                }
            }

            // 4. Text-Visualisierung für Tage mit Aktivität aufbauen
            let hasActivity = false;
            for (const day of dayNames) {
                const slots = weeklyMatrix[day];
                const activeSlotsCount = slots.filter(val => val > 0).length;

                if (activeSlotsCount > 0) {
                    hasActivity = true;
                    
                    // Finde Hauptzeiten (Peak-Blöcke)
                    let maxVal = Math.max(...slots);
                    let timeLines = [];

                    // Wir fassen benachbarte aktive Slots zu Zeitbereichen zusammen
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

                    // Visueller Minibalken als Indikator
                    let barLength = Math.min(10, Math.ceil((activeSlotsCount / 48) * 10));
                    let bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);

                    embed.addFields({
                        name: `📅 ${day}`,
                        value: `[${bar}] ${activeSlotsCount * 30} Min. aktiv\n${timeLines.slice(0, 3).join('\n')}`,
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
