// managers/statsAnalysisManager.js
const { EmbedBuilder, ActionRowBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { pool } = require('../database');

class StatsAnalysisManager {
    constructor() {
        this.name = "StatsAnalysisManager";
    }

    async sendWochenStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_wochen_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Wochen-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const payload = { content: '📊 Bitte wähle das gewünschte Mitglied für die Wochen-Ansicht aus:', components: [row] };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    async sendMonatsStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_monats_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Monats-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const payload = { content: '📅 Bitte wähle das gewünschte Mitglied für die Monats-Ansicht aus:', components: [row] };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    async sendJahresStatsMenu(interaction) {
        const selectMenu = new UserSelectMenuBuilder()
            .setCustomId('select_jahres_stats_user')
            .setPlaceholder('Wähle ein Mitglied für die Jahres-Statistik aus...')
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const payload = { content: '🏆 Bitte wähle das gewünschte Mitglied für die Jahres-Ansicht aus:', components: [row] };

        if (interaction.isStringSelectMenu() || interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: [64] });
        } else {
            await interaction.reply(payload);
        }
    }

    async sendAdminPanel(interaction) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_admin_panel_action')
            .setPlaceholder('Wähle eine Statistik-Aktion aus...')
            .addOptions([
                { label: 'Wochen-Statistik (User wählen)', value: 'cmd_wochen', description: 'Detailansicht der aktuellen Woche', emoji: '📊' },
                { label: 'Monats-Statistik (User wählen)', value: 'cmd_monat', description: 'Aggregierte Monatsübersicht', emoji: '📅' },
                { label: 'Jahres-Statistik (User wählen)', value: 'cmd_jahr', description: 'Aggregierte Jahresübersicht', emoji: '🏆' },
                { label: 'Heutige Voice-Präsenz (Alle)', value: 'cmd_heute', description: 'Übersicht wer heute aktiv war', emoji: '🎙️' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '⚙️ **Aries Stats Adminpanel**\nWähle unten die gewünschte Auswertung aus:',
            components: [row],
            flags: [64]
        });
    }

    async handleSelectMenu(interaction) {
        const customId = interaction.customId;

        if (customId === 'select_admin_panel_action') {
            await interaction.deferUpdate();
            const choice = interaction.values[0];

            if (choice === 'cmd_wochen') return this.sendWochenStatsMenu(interaction);
            if (choice === 'cmd_monat') return this.sendMonatsStatsMenu(interaction);
            if (choice === 'cmd_jahr') return this.sendJahresStatsMenu(interaction);
            if (choice === 'cmd_heute') return this.showHeuteStats(interaction);
            return;
        }

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
                embed = await this.generateWeeklyStatsEmbed(targetMember.id, cleanDisplayName);
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

    // Heutige Stats direkt aus der Kumulativ-Tabelle
    async showHeuteStats(interaction) {
        const isFromMenu = interaction.isStringSelectMenu && interaction.customId === 'select_admin_panel_action';
        if (!isFromMenu && !interaction.deferred && !interaction.replied) {
            await interaction.deferReply();
        }

        const todayString = new Date().toISOString().split('T')[0];

        await pool.query("SET client_encoding = 'UTF8'");
        const res = await pool.query(
            `SELECT user_id, total_minutes FROM user_time_stats WHERE stat_date = $1 ORDER BY total_minutes DESC`,
            [todayString]
        );

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`🎙️ HEUTIGE VOICE-AKTIVITÄT`)
            .setDescription(`Übersicht aller Voice-Minuten des heutigen Tages`)
            .setTimestamp();

        if (res.rows.length === 0) {
            embed.addFields({ name: 'Keine Aktivität', value: 'Heute gab es bisher noch keine erfassten Voice-Zeiten.' });
        } else {
            let desc = '';
            for (const row of res.rows) {
                let displayName = `User ID: ${row.user_id}`;
                try {
                    const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
                    if (member) {
                        displayName = member.displayName.replace(/^[🔴⚠️.]+/g, '').replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '').trim();
                    }
                } catch (e) {}

                const h = Math.floor(row.total_minutes / 60);
                const m = row.total_minutes % 60;
                desc += `• **${displayName}** — 🎙️ **${h}h ${m}m** (${row.total_minutes} Min.)\n`;
            }
            embed.setDescription(desc);
        }

        if (isFromMenu) {
            await interaction.followUp({ content: '🎙️ **Heutige Voice-Präsenz:**', embeds: [embed], flags: [64] });
        } else {
            await interaction.editReply({ embeds: [embed] });
        }
    }

    // Wochen-Statistik (Aktuelle KW)
    async generateWeeklyStatsEmbed(userId, targetDisplayName) {
        // Berechne aktuelle KW und Jahr
        const now = new Date();
        const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const currentWeek = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        const currentYear = d.getUTCFullYear();

        const res = await pool.query(
            `SELECT stat_date, total_minutes FROM user_time_stats 
             WHERE user_id = $1 AND year = $2 AND calendar_week = $3 
             ORDER BY stat_date ASC`,
            [userId, currentYear, currentWeek]
        );

        const totalMins = res.rows.reduce((acc, row) => acc + row.total_minutes, 0);
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;

        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📊 WOCHEN-STATISTIK: ${targetDisplayName}`)
            .setDescription(`Aktuelle Kalenderwoche (${currentWeek} / ${currentYear}) — Total: **${h}h ${m}m** (${totalMins} Min.)`)
            .setTimestamp();

        if (res.rows.length === 0) {
            embed.addFields({ name: 'Keine Daten', value: 'Für diesen User wurden in dieser Woche noch keine Zeiten erfasst.' });
        } else {
            let daysText = '';
            for (const row of res.rows) {
                let dateFormatted = new Date(row.stat_date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
                daysText += `• **${dateFormatted}**: ${row.total_minutes} Minuten\n`;
            }
            embed.addFields({ name: 'Tagesübersicht', value: daysText });
        }
        return embed;
    }

    // Monats-Statistik (Aktueller Monat)
    async generateMonthlyStatsEmbed(userId, targetDisplayName) {
        const res = await pool.query(
            `SELECT SUM(total_minutes) as total FROM user_time_stats 
             WHERE user_id = $1 
               AND stat_date >= date_trunc('month', CURRENT_TIMESTAMP)`,
            [userId]
        );

        const totalMins = res.rows[0]?.total || 0;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;

        return new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`📅 MONATS-STATISTIK: ${targetDisplayName}`)
            .setDescription(`Gesamte Voice-Präsenz im aktuellen Kalendermonat`)
            .addFields({ name: 'Gesamtzeit', value: `🎙️ **${h}h ${m}m** (${totalMins} Minuten)` })
            .setTimestamp();
    }

    // Jahres-Statistik (Laufendes Jahr)
    async generateYearlyStatsEmbed(userId, targetDisplayName) {
        const res = await pool.query(
            `SELECT SUM(total_minutes) as total FROM user_time_stats 
             WHERE user_id = $1 
               AND year = EXTRACT(YEAR FROM CURRENT_TIMESTAMP)`,
            [userId]
        );

        const totalMins = res.rows[0]?.total || 0;
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;

        return new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(`🏆 JAHRES-STATISTIK: ${targetDisplayName}`)
            .setDescription(`Gesamte Voice-Präsenz im laufenden Jahr`)
            .addFields({ name: 'Gesamtzeit', value: `🎙️ **${h}h ${m}m** (${totalMins} Minuten)` })
            .setTimestamp();
    }
}

module.exports = new StatsAnalysisManager();
