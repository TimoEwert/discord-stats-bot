// index.js - Die reine Mutter-Zentrale (Modularer Core)
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();
const { initDatabase } = require('./database');

// Alle Module zentral laden
const statsManager = require('./managers/statsManager');
const visualManager = require('./managers/visualManager');
const nicknameManager = require('./managers/nicknameManager');
const commandManager = require('./managers/commandManager');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    failIfNotExists: false
});

process.on('unhandledRejection', error => {
    console.error('⚠️ [FATAL] Unbehandeltes Promise-Rejection:', error);
});

client.once('clientReady', async () => {
    console.log(`✅ [INIT] Bot online als ${client.user.tag}`);
    await initDatabase();

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        const commands = commandManager.getCommandBuilders();
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ [DISCORD] Alle Slash-Commands erfolgreich über Module registriert.');
    } catch (error) {
        console.error("❌ [DISCORD ERROR]:", error);
    }
});

// Event: Voice State Update verteilt die Arbeit strikt an die zuständigen Module
client.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const justJoined = !oldState.channelId && newState.channelId;
    const justLeft = oldState.channelId && !newState.channelId;
    const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    // 1. Statistiken (DB-Tracking)
    if (justJoined) {
        statsManager.handleJoin(member);
    } else if (justLeft) {
        statsManager.handleLeave(member);
    } else if (switched) {
        statsManager.handleLeave(member);
        statsManager.handleJoin(member);
    }

    // 2. Visuelle Kanal-Änderung (NUR beim kompletten Verlassen / Offline gehen)
    if (justLeft) {
        visualManager.handleLeave(oldState.channel, member);
    }

    // 3. Nickname-Manager (Klassen & 10s-Alarm bei Join/Switch)
    nicknameManager.handleVoiceStateUpdate(oldState, newState);
});

// Event: Slash Commands an den CommandManager übergeben
client.on('interactionCreate', async (interaction) => {
    await commandManager.handleInteraction(interaction, client);
});

client.login(process.env.DISCORD_TOKEN);
