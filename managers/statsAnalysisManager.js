// managers/statsAnalysisManager.js
const { EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { pool } = require('../database');

class StatsAnalysisManager {
    constructor() {
        this.name = "StatsAnalysisManager";
    }

    // 1. Dropdown für Wochen-Stats (User-Auswahl)
    async sendWochenStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_wochen_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Wochen-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const payload = {
            content: '📊 Bitte wähle das gewünschte Mitglied für die Wochen-Ansicht aus:',
            components: [row]
        };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    // 2. Dropdown für Monats-Stats (User-Auswahl)
    async sendMonatsStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_monats_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Monats-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const payload = {
            content: '📅 Bitte wähle das gewünschte Mitglied für die Monats-Ansicht aus:',
            components: [row]
        };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    // 3. Dropdown für Jahres-Stats (User-Auswahl)
    async sendJahresStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_jahres_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Jahres-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const payload = {
            content: '🏆 Bitte wähle das gewünschte Mitglied für die Jahres-Ansicht aus:',
            components: [row]
        };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    // 4. Adminpanel /stats mit Funktions-Dropdown
    async sendAdminPanel(interaction) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_admin_panel_action')
            .setPlaceholder('Wähle eine Statistik-Aktion aus...')
            .addOptions([
                { label: 'Wochen-Statistik (User wählen)', value: 'cmd_wochen', description: 'Minutengenaue Detailansicht der aktuellen Woche', emoji: '📊' },
                { label: 'Monats-Statistik (User wählen)', value: 'cmd_monat', description: 'Aggregierte Monatsübersicht', emoji: '📅' },
                { label: 'Jahres-Statistik (User wählen)', value: 'cmd_jahr', description: 'Aggregierte Jahresübersicht', emoji: '🏆' },
                { label: 'Heutige Voice-Präsenz (Alle)', value: 'cmd_heute', description: 'Übersicht wer heute in welchen Kanälen war', emoji: '🎙️' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '⚙️ **Aries Stats Adminpanel**\nWähle unten die gewünschte Auswertung aus:',
            components: [row],
            flags: [64]
        });
    }

    // Router für Interaktionen aus Select-Menüs
    async handleSelectMenu(interaction) {
        const customId = interaction.customId;

        // Adminpanel-Verteilung
        if (customId === 'select_admin_panel_action') {
            await interaction.deferUpdate();
            const choice = interaction.values[0];

            if (choice === 'cmd_wochen') return this.sendWochenStatsMenu(interaction);
            if (choice === 'cmd_monat') return this.sendMonatsStatsMenu(interaction);
            if (choice === 'cmd_jahr') return this.sendJahresStatsMenu(interaction);
            if (choice === 'cmd_heute') return this.showHeuteStats(interaction);
            return;
        }

        // User-Auswertungen verarbeiten
        if (['select_wochen_stats_user', 'select_monats_stats_user', 'select_jahres_stats_user'].includes(customId)) {
            await interaction.deferUpdate();
            const selectedUserId = interaction.values[0];

            const targetMember = await interaction.guild.members.fetch(selectedUserId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply({ content: `❌ Das ausgewählte Mitglied konnte nicht gefunden werden.`, components: [], embeds: [] });
                return;
            }

            let cleanDisplayName = targetMember.displayName
                .replace(/^[🔴⚠️.]+/g, '')
                .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '')
                .trim();

            let embed;
            if (customId === 'select_wochen_stats_user') {
                embed = await this.generateWeeklyHeatmapEmbed(interaction.guild, targetMember.id, cleanDisplayName);
            } else if (customId === 'select_monats_stats_user') {
                embed = await this.generateMonthlyStatsEmbed(targetMember.id, cleanDisplayName);
            } else if (customId === 'select_jahres_stats_user') {
                embed = await this.generateYearlyStatsEmbed(targetMember.id, cleanDisplayName);
            }

            await interaction.editReply({ 
                content: `📊 Statistik-Auswertung für **${cleanDisplayName}** (angefordert von <@${interaction.user.id}>):`, 
                embeds: [embed], 
                components: [] 
            });
        }
    }

    // /heute Befehl
    async showHeuteStats(interaction) {
        const isFromMenu = interaction.isStringSelectMenu && interaction.customId === 'select_admin_panel_action';
        if (!isFromMenu && !interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        await pool.query("SET client_encoding = 'UTF8'");
        const res = await pool.query(
            `SELECT user_id, joined_at, left_at, duration_minutes 
             FROM voice_sessions 
             WHERE joined_at >= date_trunc('day', CURRENT_TIMESTAMP)
             ORDER BY joined_at DESC`
        );

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`🎙️ HEUTIGE VOICE-AKTIVITÄT`)
            .setDescription(`Übersicht aller Sprachkanal-Besuche des heutigen Tages`)
            .setTimestamp();

        if (res.rows.length === 0) {
            embed.addFields({ name: 'Keine Aktivität', value: 'Heute gab es bisher noch keine erfassten Voice-Sessions.' });
        } else {
            const userSessions = {};
            for (const row of res.rows) {
                if (!userSessions[row.user_id]) userSessions[row.user_id] = [];
                let start = new Date(row.joined_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
                let end = new Date(row.left_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
                userSessions[row.user_id].push(`• ${start} - ${end} Uhr (${row.duration_minutes} Min.)`);
            }

            for (const [userId, sessions] of Object.entries(userSessions)) {
                let displayName = `User ID: ${userId}`;
                try {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        displayName = member.displayName.replace(/^[🔴⚠️.]+/g, '').replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '').trim();
                    }
                } catch (e) {}

                embed.addFields({
                    name: `👤 ${displayName}`,
                    value: sessions.slice(0, 5).join('\n') + (sessions.length > 5 ? `\n_(+ ${sessions.length - 5} weitere)_` : ''),
                    inline: false
                });
            }
        }

        if (isFromMenu) {
            await interaction.followUp({ content: '🎙️ **Heutige Voice-Präsenz:**', embeds: [embed], flags: [64] });
        } else {
            await interaction.editReply({ embeds: [embed] });
        }
    }

    // Wochen-Details (minutengenau aus voice_sessions für die aktuelle Woche)
    async generateWeeklyHeatmapEmbed(guild, userId, targetDisplayName) {
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
            embed.addFields({ name: 'Keine Daten', value: 'Für diesen User wurden in dieser Woche noch keine Zeiten erfasst.' });
            return embed;
        }

        const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
        const sessionsPerDay = {};
        const totalMinutesPerDay = {};
        dayNames.forEach(d => { sessionsPerDay[d] = []; totalMinutesPerDay[d] = 0; });

        for (const row of res.rows) {
            let start = new Date(row.joined_at);
            let end = new Date(row.left_at);
            let duration = row.duration_minutes || 0;

            let jsDay = start.getDay();
            let dayName = dayNames[jsDay === 0 ? 6 : jsDay - 1];

            let startTime = start.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
            let endTime = end.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });

            sessionsPerDay[dayName].push(`• ${startTime} - ${endTime} Uhr (${duration} Min.)`);
            totalMinutesPerDay[dayName] += duration;
        }

        for (const day of dayNames) {
            if (sessionsPerDay[day].length > 0) {
                embed.addFields({
                    name: `📅 ${day} — Total: ${totalMinutesPerDay[day]} Min.`,
                    value: sessionsPerDay[day].join('\n'),
                    inline: false
                });
            }
        }
        return embed;
    }

    // Monats-Statistik (aus week_times für den aktuellen Monat)
    async generateMonthlyStatsEmbed(userId, targetDisplayName) {
        // Ermittelt das aktuelle Jahr und den Monat, um die Wochensummen aus week_times zu aggregieren
        const res = await pool.query(
            `SELECT SUM(total_minutes) as total FROM week_times 
             WHERE user_id = $1 
               AND year = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)
               -- Filter für Wochen, die in den aktuellen Monat fallen (grob über ISO-Wochen / Datum)
               `,
            [userId]
        );

        // Alternativ oder ergänzend: Da week_times Kalenderwochen speichert, summieren wir hier über die Wochen des Monats
        const resMonth = await pool.query(
            `SELECT SUM(wt.total_minutes) as total 
             FROM week_times wt
             JOIN (
                 SELECT DISTINCT EXTRACT(WEEK FROM d)::int as cw, EXTRACT(YEAR FROM d)::int as yr
                 FROM generate_series(date_trunc('month', CURRENT_TIMESTAMP), date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month - 1 day', INTERVAL '1 day') d
             ) m ON wt.calendar_week = m.cw AND wt.year = m.yr
             WHERE wt.user_id = $1`,
            [userId]
        );

        const totalMins = resMonth.rows[0].total || 0;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;

        return new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`📅 MONATS-STATISTIK: ${targetDisplayName}`)
            .setDescription(`Gesamte Voice-Präsenz im aktuellen Kalendermonat (aus week_times)`)
            .addFields({ name: 'Gesamtzeit', value: `🎙️ **${h}h ${m}m** (${totalMins} Minuten)` })
            .setTimestamp();
    }

    // Jahres-Statistik (direkt aus year_times)
    async generateYearlyStatsEmbed(userId, targetDisplayName) {
        const res = await pool.query(
            `SELECT total_minutes FROM year_times 
             WHERE user_id = $1 
               AND year = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)`,
            [userId]
        );

        const totalMins = res.rows[0]?.total_minutes || 0;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;

        return new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(`🏆 JAHRES-STATISTIK: ${targetDisplayName}`)
            .setDescription(`Gesamte Voice-Präsenz im laufenden Jahr (aus year_times)`)
            .addFields({ name: 'Gesamtzeit', value: `🎙️ **${h}h ${m}m** (${totalMins} Minuten)` })
            .setTimestamp();
    }
}

module.exports = new StatsAnalysisManager();
