// managers/commandManager.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../database');
const statsAnalysisManager = require('./statsAnalysisManager');
const nicknameManager = require('./nicknameManager');
const statsPostManager = require('./statsPost');

class CommandManager {
    constructor() {
        this.name = "CommandManager";
    }

    getCommandBuilders() {
        return [
            new SlashCommandBuilder().setName('wochen_stats').setDescription('Öffnet die wöchentliche Detail-Matrix eines Users'),
            new SlashCommandBuilder().setName('monats_stats').setDescription('Öffnet die Monatsübersicht eines Users'),
            new SlashCommandBuilder().setName('jahres_stats').setDescription('Öffnet die Jahresübersicht eines Users'),
            new SlashCommandBuilder().setName('heute').setDescription('Zeigt wer heute im Sprachkanal war'),
            new SlashCommandBuilder().setName('stats').setDescription('Öffnet das Adminpanel für Statistiken').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('sync_nicknames').setDescription('Aktualisiert Klassen-Nicknames').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('ranking_aries').setDescription('Zeigt das Voice-Ranking der aktuellen Woche'),
            new SlashCommandBuilder().setName('save_channel_refs').setDescription('Speichert Kanal-Referenzen').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('reset_channel_refs').setDescription('Setzt Kanäle zurück').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('test_post_stats').setDescription('Testet den wöchentlichen Voice-Rückblick manuell').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
    }

    async handleInteraction(interaction, client) {
        if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
            await statsAnalysisManager.handleSelectMenu(interaction);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        console.log(`🤖 [COMMAND] Befehl empfangen: /${interaction.commandName} von User ${interaction.user.tag}`);

        try {
            if (interaction.commandName === 'wochen_stats') {
                await statsAnalysisManager.sendWochenStatsMenu(interaction);
            }
            else if (interaction.commandName === 'monats_stats') {
                await statsAnalysisManager.sendMonatsStatsMenu(interaction);
            }
            else if (interaction.commandName === 'jahres_stats') {
                await statsAnalysisManager.sendJahresStatsMenu(interaction);
            }
            else if (interaction.commandName === 'heute') {
                await statsAnalysisManager.showHeuteStats(interaction);
            }
            else if (interaction.commandName === 'stats') {
                await statsAnalysisManager.sendAdminPanel(interaction);
            }
            else if (interaction.commandName === 'test_post_stats') {
                await interaction.deferReply({ flags: [64] });
                const success = await statsPostManager.postWeeklyDetailedStats(interaction.client, interaction.channel);

                if (success) {
                    await interaction.editReply({ content: '✅ Der detaillierte Wochen-Rückblick wurde erfolgreich in diesen Kanal gepostet!' });
                } else {
                    await interaction.editReply({ content: '❌ Fehler beim Erstellen des Wochen-Rückblicks.' });
                }
            }
            else if (interaction.commandName === 'save_channel_refs') {
                await interaction.deferReply({ flags: [64] });
                await pool.query("SET client_encoding = 'UTF8'");

                const channels = interaction.guild.channels.cache.filter(c => c.isVoiceBased());
                let count = 0;

                const manualOverrides = {
                    "1558396597702889522": "👑 | Lead Meeting",
                    "1558396122580390019": "💤 | AFK",
                    "1558398389866078319": "👥| Recruiting",
                    "1558384720411365407": "🗨️| Community Hangout"
                };

                for (const [_, channel] of channels) {
                    let cleanName = manualOverrides[channel.id] || channel.name.normalize('NFC').replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                    let base64Name = Buffer.from(cleanName, 'utf8').toString('base64');

                    await pool.query(
                        `INSERT INTO channel_references (channel_id, original_name) 
                         VALUES ($1, CONVERT_FROM(DECODE($2, 'base64'), 'UTF8')) 
                         ON CONFLICT (channel_id) 
                         DO UPDATE SET original_name = CONVERT_FROM(DECODE($2, 'base64'), 'UTF8')`,
                        [channel.id, base64Name]
                    );
                    count++;
                }
                await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich gespeichert!`);
            }
            else if (interaction.commandName === 'reset_channel_refs') {
                await interaction.deferReply({ flags: [64] });
                await pool.query("SET client_encoding = 'UTF8'");
                const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);

                if (result.rows.length === 0) {
                    await interaction.editReply(`❌ Keine Kanal-Referenzen gefunden. Bitte zuerst /save_channel_refs ausführen.`);
                    return;
                }

                let resetCount = 0;
                for (const row of result.rows) {
                    const channel = interaction.guild.channels.cache.get(row.channel_id);
                    if (channel && channel.isVoiceBased()) {
                        try {
                            await channel.setName(row.original_name);
                            resetCount++;
                        } catch (apiErr) {}
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
                await interaction.editReply(`✅ **${resetCount}** von ${result.rows.length} Sprachkanälen zurückgesetzt!`);
            }
            else if (interaction.commandName === 'ranking_aries') {
                await interaction.deferReply();
                // Wieder zurück auf voice_sessions gestellt, damit es sich wöchentlich leert
                const result = await pool.query(`SELECT user_id, SUM(duration_minutes) as total_minutes FROM voice_sessions GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10`);
                const embed = new EmbedBuilder().setColor(0x00AE86).setTitle('🏆 ARIES COMMUNITY - VOICE RANKING (AKTUELL)').setTimestamp();
                
                if (result.rows.length === 0) {
                    embed.addFields({ name: 'Keine Daten', value: 'Es wurden in dieser Woche noch keine Voice-Zeiten aufgezeichnet.' });
                } else {
                    let desc = '';
                    for (let i = 0; i < result.rows.length; i++) {
                        const row = result.rows[i];
                        let displayName = `Unbekannter User (${row.user_id})`;
                        try {
                            const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
                            if (member) {
                                displayName = member.displayName.replace(/^[🔴⚠️.]+/g, '').replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+/g, '').trim();
                            }
                        } catch (err) {}

                        const h = Math.floor(row.total_minutes / 60);
                        const m = row.total_minutes % 60;
                        let medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        
                        desc += `${medal} **${displayName}** — 🎙️ **${h}h ${m}m** (${row.total_minutes} Min.)\n`;
                    }
                    embed.setDescription(desc);
                }
                await interaction.editReply({ embeds: [embed] });
            }
            else if (interaction.commandName === 'sync_nicknames') {
                await interaction.deferReply({ flags: [64] });
                const members = await interaction.guild.members.fetch();
                let updatedCount = 0;
                
                for (const [_, member] of members) {
                    if (member.user.bot) continue;
                    const changed = await nicknameManager.updateMemberNickname(member, false);
                    if (changed) {
                        updatedCount++;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder synchronisiert.`);
            }
        } catch (e) {
            console.error("❌ [COMMAND ERROR]:", e);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(`❌ Ein Fehler ist aufgetreten: ${e.message}`).catch(() => {});
            } else {
                await interaction.reply({ content: `❌ Ein Fehler ist aufgetreten: ${e.message}`, flags: [64] }).catch(() => {});
            }
        }
    }
}

module.exports = new CommandManager();
