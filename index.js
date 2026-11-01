// index.js - Version 7.0 (Modulare Zentrale)
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { pool, initDatabase } = require('./database');

// Module importieren (Hier kannst du in Zukunft ganz einfach weitere Module ergänzen!)
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

// Event: Leitet Events sauber an die jeweiligen Module weiter
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

// Slash Commands Handler (Platzhalter für Befehle)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'save_channel_refs') {
        await interaction.deferReply({ flags: [64] });
        const channels = interaction.guild.channels.cache.filter(c => c.isVoiceBased());
        let count = 0;
        for (const [_, channel] of channels) {
            let cleanName = channel.name.replace(/^🔴.*?\s+ging$/, '').trim();
            await pool.query(`INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET original_name = EXCLUDED.original_name`, [channel.id, cleanName]);
            count++;
        }
        await interaction.editReply(`✅ **${count}** Kanal-Referenzen gespeichert!`);
    }
    // Weitere Befehle hier nach Bedarf...
});

client.login(process.env.DISCORD_TOKEN);
