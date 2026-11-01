// managers/commandManager.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { pool } = require('../database');
const nicknameManager = require('./nicknameManager');

class CommandManager {
    constructor() {
        this.name = "CommandManager";
    }

    getCommandBuilders() {
        return [
            new SlashCommandBuilder().setName('sync_nicknames').setDescription('Aktualisiert Klassen-Nicknames').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('ranking_aries').setDescription('Zeigt das Voice-Ranking'),
            new SlashCommandBuilder().setName('wochen_stats').setDescription('Zeigt Stammzeiten'),
            new SlashCommandBuilder().setName('save_channel_refs').setDescription('Speichert Kanal-Referenzen').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('reset_channel_refs').setDescription('Setzt Kanäle zurück').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
    }

    async handleInteraction(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        // DEBUG-LOG: Zeigt sofort in Railway an, welcher Befehl getriggert wurde!
        console.log(`🤖 [COMMAND] Befehl empfangen: /${interaction.commandName} von User ${interaction.user.tag}`);

        try {
            if (interaction.commandName === 'save_channel_refs') {
                await interaction.deferReply({ flags: [64] });
                const channels = interaction.guild.channels.cache.filter(c => c.isVoiceBased());
                let count = 0;
                for (const [_, channel] of channels) {
                    let cleanName = channel.name.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                    await pool.query(
                        `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET original_name = EXCLUDED.original_name`,
                        [channel.id, cleanName || "Voice Channel"]
                    );
                    count++;
                }
                await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich gespeichert!`);
            }
            else if (interaction.commandName === 'reset_channel_refs') {
                await interaction.deferReply({ flags: [64] });
                const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
                if (result.rows.length === 0) {
                    await interaction.editReply(`❌ Keine Kanal-Referenzen in der Datenbank gefunden. Bitte zuerst /save_channel_refs ausführen.`);
                    return;
                }
                let resetCount = 0;
                for (const row of result.rows) {
                    const channel = interaction.guild.channels.cache.get(row.channel_id);
                    if (channel && channel.isVoiceBased()) {
                        await channel.setName(row.original_name);
                        resetCount++;
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
                await interaction.editReply(`✅ **${resetCount}** Sprachkanäle wurden manuell auf ihre Original-Referenzen zurückgesetzt!`);
            }
            else if (interaction.commandName === 'ranking_aries') {
                await interaction.deferReply();
                const result = await pool.query(`SELECT username, SUM(duration_seconds) as total_seconds FROM voice_sessions GROUP BY username ORDER BY total_seconds DESC LIMIT 10`);
                const embed = new EmbedBuilder().setColor(0x00AE86).setTitle('🏆 ARIES COMMUNITY - VOICE RANKING').setTimestamp();
                
                if (result.rows.length === 0) {
                    embed.addFields({ name: 'Keine Daten', value: 'Es wurden noch keine Voice-Zeiten aufgezeichnet.' });
                } else {
                    let desc = '';
                    result.rows.forEach((row, i) => {
                        const h = Math.floor(row.total_seconds / 3600);
                        const m = Math.floor((row.total_seconds % 3600) / 60);
                        let medal = `#${i + 1}`;
                        if (i === 0) medal = '🥇';
                        if (i === 1) medal = '🥈';
                        if (i === 2) medal = '🥉';
                        desc += `${medal} **${row.username}** — 🎙️ **${h}h ${m}m**\n`;
                    });
                    embed.setDescription(desc);
                }
                await interaction.editReply({ embeds: [embed] });
            }
            else if (interaction.commandName === 'wochen_stats') {
                await interaction.deferReply();
                const embed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('📊 COMMUNITY STAMMZEITEN')
                    .setDescription('Auswertung der Sprachkanal-Präsenzen aktiv.')
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
            else if (interaction.commandName === 'sync_nicknames') {
                await interaction.deferReply({ flags: [64] });
                const members = await interaction.guild.members.fetch();
                let updatedCount = 0;
                for (const [_, member] of members) {
                    if (member.user.bot) continue;
                    const changed = await nicknameManager.updateMemberNickname(member, client);
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
