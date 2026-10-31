// index.js - Version 2.0 (Senior Programming Partner)
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits 
} = require('discord.js');
require('dotenv').config();
const { pool, initDatabase } = require('./database');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Klassen-Definitionen & Icons
const CLASS_ICONS = {
    "Magier": "🔥",
    "Templer": "🛡️",
    "Gladiator": "⚔️",
    "Assasine": "🗡️",
    "Waldläufer": "🏹",
    "Beschwörer": "👻",
    "Kleriker": "❤️",
    "Kantor": "🔱"
};

const WARNING_ICONS = ".⚠️⚠️⚠️";
const ALL_ICONS_ARRAY = [...Object.values(CLASS_ICONS), WARNING_ICONS, ".⚠️⚠️⚠️", "⚠️", "."];

// Maps für Timers und Voice-Session-Startzeiten
const activeVoiceTimers = new Map();
const activeVoiceSessions = new Map();

process.on('unhandledRejection', error => {
    console.error('⚠️ Unbehandeltes Promise-Rejection abgefangen:', error);
});

client.once('ready', async () => {
    console.log(`✅ Bot online als ${client.user.tag}`);
    await initDatabase();

    // Slash Commands registrieren
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('sync_nicknames')
                .setDescription('Aktualisiert die Rollen-Icons im Nicknamen und speichert Klassen in der DB')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash-Commands erfolgreich registriert.');
    } catch (error) {
        console.error("Fehler beim Registrieren der Befehle:", error);
    }
});

// Event: Voice State Update (Tracking + 10s Nickname-Warnung)[cite: 2]
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const username = member.user.tag;
    const justJoinedVoice = !oldState.channelId && newState.channelId;
    const justLeftVoice = oldState.channelId && !newState.channelId;

    // 1. Voice-Zeit in Datenbank loggen (für das spätere Ranking & die Statistik)
    if (justJoinedVoice) {
        activeVoiceSessions.set(userId, new Date());
        
        // 10-Sekunden Nickname-Warnung triggern[cite: 2]
        if (activeVoiceTimers.has(userId)) {
            clearTimeout(activeVoiceTimers.get(userId));
        }
        await updateMemberNickname(member, true);
        const timer = setTimeout(async () => {
            activeVoiceTimers.delete(userId);
            await updateMemberNickname(member, false);
        }, 10 * 1000);
        activeVoiceTimers.set(userId, timer);

    } else if (justLeftVoice) {
        const joinTime = activeVoiceSessions.get(userId);
        if (joinTime) {
            const leaveTime = new Date();
            const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);

            try {
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                    [userId, username, joinTime, leaveTime, durationSeconds]
                );
            } catch (err) {
                console.error('❌ Fehler beim Speichern der Voice-Session:', err);
            }
            activeVoiceSessions.delete(userId);
        }
    }
});

// Event: Slash Commands verarbeiten
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'sync_nicknames') {
        await interaction.deferReply({ flags: [64] }); // Ephemeral reply

        try {
            const members = await interaction.guild.members.fetch();
            let updatedCount = 0;

            for (const [_, member] of members) {
                if (member.user.bot) continue;
                
                const changed = await updateMemberNickname(member, false);
                if (changed) updatedCount++;
                
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder aktualisiert und in der Datenbank synchronisiert.`);
        } catch (e) {
            console.error("Fehler beim Sync-Befehl:", e);
            await interaction.editReply(`❌ Ein Fehler ist aufgetreten: ${e.message}`);
        }
    }
});

// Hilfsfunktion: Nickname anpassen & Klassen in PostgreSQL ablegen
async function updateMemberNickname(member, showWarning = false) {
    if (member.id === member.guild.ownerId || member.id === client.user.id) {
        return false;
    }

    try {
        // Klasse anhand der Rollen ermitteln
        const matchedRole = member.roles.cache.find(role => CLASS_ICONS[role.name]);
        const className = matchedRole ? matchedRole.name : null;
        const classIcon = className ? CLASS_ICONS[className] : null;

        // Wenn eine Klasse gefunden wurde, direkt in der PostgreSQL-Datenbank speichern
        if (className && classIcon) {
            await pool.query(
                `INSERT INTO user_classes (user_id, username, class_name, icon, updated_at) 
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (user_id) 
                 DO UPDATE SET username = EXCLUDED.username, class_name = EXCLUDED.class_name, icon = EXCLUDED.icon, updated_at = NOW()`,
                [member.id, member.user.tag, className, classIcon]
            );
        }

        // Nickname-Bereinigung und Formatierung[cite: 2]
        const userIcons = member.roles.cache
            .filter(role => CLASS_ICONS[role.name])
            .map(role => CLASS_ICONS[role.name]);

        let cleanName = member.displayName;
        cleanName = cleanName.replace(/\s*\|\s*$/, '').trim();

        ALL_ICONS_ARRAY.forEach(icon => {
            cleanName = cleanName.split(icon).join('');
        });

        cleanName = cleanName.replace(/⚠️/g, '').trim();
        cleanName = cleanName.replace(/^\./, '').trim();
        cleanName = cleanName.replace(/\s*\|\s*$/, '').trim();

        if (!cleanName) {
            cleanName = member.user.username;
        }

        let newName = cleanName;

        if (showWarning) {
            newName = `${WARNING_ICONS} ${cleanName}`.substring(0, 32);
        } else {
            if (userIcons.length > 0) {
                newName = `${cleanName} | ${userIcons.join('')}`.substring(0, 32);
            }
        }

        if (member.displayName !== newName) {
            await member.setNickname(newName);
            return true;
        }
    } catch (e) {
        console.error(`❌ Fehler beim Anpassen des Nicknamens für ${member.user.tag}:`, e.message);
    }
    return false;
}

client.login(process.env.DISCORD_TOKEN);
