// index.js - Version 7.1 (Modulare Zentrale mit vollständigem Command-Handler)
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { pool, initDatabase } = require('./database');

// Module importieren
const statsManager = require('./managers/statsManager');
const visualManager = require('./managers/visualManager');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    failIfNotExists: false
});

const CLASS_ICONS = {
    "Magier": "🔥", "Templer": "🛡️", "Gladiator": "⚔️", "Assasine": "🗡️",
    "Waldläufer": "🏹", "Beschwörer": "👻", "Kleriker": "❤️", "Kantor": "🔱"
};

process.on('unhandledRejection', error => {
    console.error('⚠️ [FATAL] Unbehandeltes Promise-Rejection:', error);
});

client.once('clientReady', async () => {
    console.log(`✅ [INIT] Bot online als ${client.user.tag}`);
    await initDatabase();

    // Slash Commands registrieren
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        const commands = [
            new SlashCommandBuilder().setName('sync_nicknames').setDescription('Aktualisiert Klassen-Nicknames').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('ranking_aries').setDescription('Zeigt das Voice-Ranking'),
            new SlashCommandBuilder().setName('wochen_stats').setDescription('Zeigt Stammzeiten'),
            new SlashCommandBuilder().setName('save_channel_refs').setDescription('Speichert Kanal-Referenzen').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder().setName('reset_channel_refs').setDescription('Setzt Kanäle zurück').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ [DISCORD] Slash-Commands registriert.');
    } catch (error) {
        console.error("❌ [DISCORD ERROR]:", error);
    }
});

// Event: Leitet Voice-Events an die Module weiter
client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const username = member.user.tag;
    const displayName = member.displayName;

    const justJoined = !oldState.channelId && newState.channelId;
    const justLeft = oldState.channelId && !newState.channelId;
    const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if (justJoined) {
        statsManager.handleJoin(userId, username);
    } else if (justLeft) {
        statsManager.handleLeave(userId, username);
        visualManager.triggerChannelLeaveAlert(oldState.channel, `🔴${displayName} ging`);
    } else if (switched) {
        statsManager.handleLeave(userId, username);
        statsManager.handleJoin(userId, username);
        visualManager.triggerChannelLeaveAlert(oldState.channel, `🔴${displayName} ging`);
    }
});

// Vollständiger Slash-Command Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        // 1. /save_channel_refs
        if (interaction.commandName === 'save_channel_refs') {
            await interaction.deferReply({ flags: [64] });
            const channels = interaction.guild.channels.cache.filter(c => c.isVoiceBased());
            let count = 0;
            for (const [_, channel] of channels) {
                let cleanName = channel.name.replace(/^🔴.*?\s+ging$/, '').trim();
                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET original_name = EXCLUDED.original_name`,
                    [channel.id, cleanName || "Voice Channel"]
                );
                count++;
            }
            await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich gespeichert!`);
        }

        // 2. /reset_channel_refs
        else if (interaction.commandName === 'reset_channel_refs') {
            await interaction.deferReply({ flags: [64] });
            const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
            if (result.rows.length === 0) {
                await interaction.editReply(`❌ Keine Kanal-Referenzen in der Datenbank gefunden.`);
                return;
            }
            let resetCount = 0;
            for (const row of result.rows) {
                const channel = interaction.guild.channels.cache.get(row.channel_id);
                if (channel && channel.isVoiceBased()) {
                    await channel.setName(row.original_name);
                    resetCount++;
                    await new Promise(r => setTimeout(r, 1000)); // 1s Pause gegen Rate-Limits
                }
            }
            await interaction.editReply(`✅ **${resetCount}** Sprachkanäle wurden auf ihre Original-Referenzen zurückgesetzt!`);
        }

        // 3. /ranking_aries
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

        // 4. /wochen_stats
        else if (interaction.commandName === 'wochen_stats') {
            await interaction.deferReply();
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📊 COMMUNITY STAMMZEITEN')
                .setDescription('Auswertung der Sprachkanal-Präsenzen aktiv.')
                .addFields({ name: '🟢 Haupt-Stoßzeiten', value: 'Mittwoch & Freitag (18:00 - 22:00 Uhr)\nSamstag (Nachmittag / Abend)', inline: false })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }

        // 5. /sync_nicknames
        else if (interaction.commandName === 'sync_nicknames') {
            await interaction.deferReply({ flags: [64] });
            const members = await interaction.guild.members.fetch();
            let updatedCount = 0;
            for (const [_, member] of members) {
                if (member.user.bot) continue;
                // Hier greift die Klassen-Erkennung
                const matchedRole = member.roles.cache.find(role => CLASS_ICONS[role.name]);
                if (matchedRole) {
                    const classIcon = CLASS_ICONS[matchedRole.name];
                    let newName = `${member.user.username} | ${classIcon}`.substring(0, 32);
                    if (member.displayName !== newName && member.id !== interaction.guild.ownerId) {
                        await member.setNickname(newName);
                        updatedCount++;
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
            }
            await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder synchronisiert.`);
        }

    } catch (e) {
        console.error("❌ [INTERACTION ERROR]:", e);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(`❌ Ein Fehler ist aufgetreten: ${e.message}`).catch(() => {});
        } else {
            await interaction.reply({ content: `❌ Ein Fehler ist aufgetreten: ${e.message}`, flags: [64] }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
