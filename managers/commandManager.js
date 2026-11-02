// managers/commandManager.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { pool } = require('../database');
const statsAnalysisManager = require('./statsAnalysisManager');

class CommandManager {
    constructor() {
        this.name = "CommandManager";
    }

    getCommandBuilders() {
        return [
            new SlashCommandBuilder().setName('sync_nicknames').setDescription('Aktualisiert Klassen-Nicknames').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('ranking_aries').setDescription('Zeigt das Voice-Ranking'),
            new SlashCommandBuilder().setName('wochen_stats').setDescription('Zeigt die wöchentliche Aktivitäts-Matrix eines Users'),
            new SlashCommandBuilder().setName('save_channel_refs').setDescription('Speichert Kanal-Referenzen').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('reset_channel_refs').setDescription('Setzt Kanäle zurück').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
    }

    async handleInteraction(interaction, client) {
        // 1. Handle Modals (Eingabe des User-Namens für die wöchentlichen Stats)
        if (interaction.isModalSubmit() && interaction.customId === 'modal_wochen_stats') {
            await interaction.deferReply();
            
            const searchInput = interaction.fields.getTextInputValue('input_username').trim().toLowerCase();
            
            try {
                // Hole alle Mitglieder, um den passenden User zu finden
                await interaction.guild.members.fetch();
                const members = interaction.guild.members.cache;
                
                let targetMember = null;
                for (const [_, member] of members) {
                    if (member.user.bot) continue;
                    let displayName = (member.displayName || member.user.username)
                        .replace(/^[🔴⚠️.]+/g, '')
                        .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '')
                        .trim()
                        .toLowerCase();
                    
                    let username = member.user.username.toLowerCase();

                    if (displayName.includes(searchInput) || username.includes(searchInput)) {
                        targetMember = member;
                        break;
                    }
                }

                if (!targetMember) {
                    await interaction.editReply(`❌ Es wurde kein Mitglied gefunden, das auf "**${searchInput}**" passt.`);
                    return;
                }

                let cleanDisplayName = targetMember.displayName
                    .replace(/^[🔴⚠️.]+/g, '')
                    .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '')
                    .trim();

                // Generiere das Heatmap-Embed über den Analysis Manager
                const embed = await statsAnalysisManager.generateWeeklyHeatmapEmbed(
                    interaction.guild, 
                    targetMember.id, 
                    cleanDisplayName
                );

                await interaction.editReply({ embeds: [embed] });

            } catch (err) {
                console.error("❌ [MODAL ERROR]:", err);
                await interaction.editReply(`❌ Ein Fehler ist bei der Auswertung aufgetreten: ${err.message}`);
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        console.log(`🤖 [COMMAND] Befehl empfangen: /${interaction.commandName} von User ${interaction.user.tag}`);

        try {
            // Befehl zum Speichern der aktuellen Sprachkanal-Namen
            if (interaction.commandName === 'save_channel_refs') {
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
                    let cleanName;

                    if (manualOverrides[channel.id]) {
                        cleanName = manualOverrides[channel.id];
                    } else {
                        let rawName = channel.name.normalize('NFC');
                        cleanName = rawName.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                    }

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
                console.log(`✅ [DB SAVE] ${count} Kanal-Referenzen erfolgreich gespeichert.`);
                await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich gespeichert!`);
            }
            // Befehl zum Zurücksetzen der Sprachkanäle
            else if (interaction.commandName === 'reset_channel_refs') {
                await interaction.deferReply({ flags: [64] });
                
                await pool.query("SET client_encoding = 'UTF8'");
                const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
                console.log(`🔍 [DB QUERY] Gefundene Kanal-Referenzen in DB: ${result.rows.length}`);

                if (result.rows.length === 0) {
                    await interaction.editReply(`❌ Keine Kanal-Referenzen in der Datenbank gefunden. Bitte zuerst /save_channel_refs ausführen.`);
                    return;
                }

                let resetCount = 0;
                for (const row of result.rows) {
                    const channel = interaction.guild.channels.cache.get(row.channel_id);
                    if (channel && channel.isVoiceBased()) {
                        try {
                            await channel.setName(row.original_name);
                            console.log(`✨ [RESET SUCCESS] Kanal ID ${row.channel_id} auf '${row.original_name}' zurückgesetzt.`);
                            resetCount++;
                        } catch (apiErr) {
                            console.error(`❌ [DISCORD API ERROR] Konnte Kanal ${row.channel_id} (${row.original_name}) nicht umbenennen:`, apiErr.message);
                        }
                        await new Promise(r => setTimeout(r, 300));
                    } else {
                        console.log(`⚠️ [RESET SKIP] Kanal ID ${row.channel_id} nicht im Cache gefunden oder kein Voice-Kanal.`);
                    }
                }
                await interaction.editReply(`✅ **${resetCount}** von ${result.rows.length} Sprachkanälen wurden zurückgesetzt!`);
            }
            // Befehl zur Anzeige des Voice-Rankings
            else if (interaction.commandName === 'ranking_aries') {
                await interaction.deferReply();
                
                const result = await pool.query(`SELECT user_id, SUM(duration_minutes) as total_minutes FROM voice_sessions GROUP BY user_id ORDER BY total_minutes DESC LIMIT 10`);
                const embed = new EmbedBuilder().setColor(0x00AE86).setTitle('🏆 ARIES COMMUNITY - VOICE RANKING').setTimestamp();
                
                if (result.rows.length === 0) {
                    embed.addFields({ name: 'Keine Daten', value: 'Es wurden noch keine Voice-Zeiten aufgezeichnet.' });
                } else {
                    let desc = '';
                    for (let i = 0; i < result.rows.length; i++) {
                        const row = result.rows[i];
                        
                        let displayName = `Unbekannter User (${row.user_id})`;
                        try {
                            const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
                            if (member) {
                                displayName = member.displayName
                                    .replace(/^[🔴⚠️.]+/g, '')
                                    .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '')
                                    .trim();
                            }
                        } catch (err) {}

                        const h = Math.floor(row.total_minutes / 60);
                        const m = row.total_minutes % 60;
                        
                        let medal = `#${i + 1}`;
                        if (i === 0) medal = '🥇';
                        if (i === 1) medal = '🥈';
                        if (i === 2) medal = '🥉';
                        
                        desc += `${medal} **${displayName}** — 🎙️ **${h}h ${m}m** (${row.total_minutes} Min.)\n`;
                    }
                    embed.setDescription(desc);
                }
                await interaction.editReply({ embeds: [embed] });
            }
            // Neuer Befehl: /wochen_stats öffnet nun das Modal zur User-Auswahl
            else if (interaction.commandName === 'wochen_stats') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_wochen_stats')
                    .setTitle('📊 Wochen-Aktivitätsstatistik');

                const userInput = new TextInputBuilder()
                    .setCustomId('input_username')
                    .setLabel('Name oder Suchbegriff des Mitglieds')
                    .setPlaceholder('z.B. Cyrill oder Murdock')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(userInput));
                await interaction.showModal(modal);
            }
            // Befehl zur Synchronisation der Klassen-Nicknames
            else if (interaction.commandName === 'sync_nicknames') {
                await interaction.deferReply({ flags: [64] });
                const members = await interaction.guild.members.fetch();
                let updatedCount = 0;
                
                const nicknameManager = require('./nicknameManager');

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
