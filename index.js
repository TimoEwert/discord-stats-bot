// index.js - Version 3.4 (Senior Programming Partner - Komplettversion)
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    EmbedBuilder 
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

const ALL_ICONS_ARRAY = [...Object.values(CLASS_ICONS), ".⚠️⚠️⚠️", "⚠️", "."];

// Map zur temporären Speicherung der Voice-Startzeiten
const activeVoiceSessions = new Map();

// Map zur sicheren Verwaltung der Kanal-Timer und Ursprungsnamen
const channelTimers = new Map();

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
                .setDescription('Aktualisiert Rollen-Icons im Nicknamen und speichert Klassen in der DB')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder()
                .setName('ranking_aries')
                .setDescription('Zeigt das Community Voice-Ranking als schickes Embed'),
            new SlashCommandBuilder()
                .setName('wochen_stats')
                .setDescription('Zeigt die Sprachaktivitäts-Statistik und Stammzeiten')
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash-Commands erfolgreich registriert.');
    } catch (error) {
        console.error("Fehler beim Registrieren der Befehle:", error);
    }
});

// Event: Voice State Update (Voice-Tracking, Klassen-Sync & 10s Channel-Umbenennung)
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const username = member.user.tag;
    const displayName = member.displayName;
    
    const justJoinedVoice = !oldState.channelId && newState.channelId;
    const justLeftVoice = oldState.channelId && !newState.channelId;
    const switchedVoice = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    // 1. Fall: User betritt ganz frisch einen Voice-Channel
    if (justJoinedVoice) {
        activeVoiceSessions.set(userId, new Date());
        
        await triggerChannelVisual(newState.channel, `🟢 ${displayName} betritt`);
        await updateMemberNickname(member);
    } 
    // 2. Fall: User verlässt den Voice-Channel komplett
    else if (justLeftVoice) {
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

        await triggerChannelVisual(oldState.channel, `🔴 ${displayName} verlässt`);
    } 
    // 3. Fall: User wechselt zwischen zwei Kanälen hin und her
    else if (switchedVoice) {
        const joinTime = activeVoiceSessions.get(userId);
        const leaveTime = new Date();

        // Alte Session für den bisherigen Kanal abschließen und speichern
        if (joinTime) {
            const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);
            if (durationSeconds > 0) {
                try {
                    await pool.query(
                        `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                        [userId, username, joinTime, leaveTime, durationSeconds]
                    );
                } catch (err) {
                    console.error('❌ Fehler beim Speichern der Voice-Session (Switch):', err);
                }
            }
        }

        // Neue Session für den Zielkanal starten
        activeVoiceSessions.set(userId, leaveTime);

        // Visualisierung sowohl im alten Kanal (Verlassen) als auch im neuen Kanal (Betreten)
        await triggerChannelVisual(oldState.channel, `🔴 ${displayName} verlässt`);
        await triggerChannelVisual(newState.channel, `🔄 ${displayName} wechselt`);

        // Klassen/Nicknamen im Hintergrund aktualisieren
        await updateMemberNickname(member);
    }
});

// Event: Slash Commands verarbeiten
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'sync_nicknames') {
        await interaction.deferReply({ flags: [64] });

        try {
            const members = await interaction.guild.members.fetch();
            let updatedCount = 0;

            for (const [_, member] of members) {
                if (member.user.bot) continue;
                const changed = await updateMemberNickname(member);
                if (changed) updatedCount++;
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder aktualisiert und Klassen in der DB gespeichert.`);
        } catch (e) {
            console.error("Fehler beim Sync-Befehl:", e);
            await interaction.editReply(`❌ Ein Fehler ist aufgetreten: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'ranking_aries') {
        await interaction.deferReply();

        try {
            const result = await pool.query(`
                SELECT username, SUM(duration_seconds) as total_seconds 
                FROM voice_sessions 
                GROUP BY username 
                ORDER BY total_seconds DESC 
                LIMIT 10
            `);

            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('🏆 ARIES COMMUNITY - VOICE RANKING')
                .setDescription('Die aktivsten Mitglieder im Sprachkanal (Gesamtauswertung)')
                .setTimestamp();

            if (result.rows.length === 0) {
                embed.addFields({ name: 'Keine Daten', value: 'Es wurden noch keine Voice-Zeiten aufgezeichnet.' });
            } else {
                let descriptionText = '';
                result.rows.forEach((row, index) => {
                    const hours = Math.floor(row.total_seconds / 3600);
                    const minutes = Math.floor((row.total_seconds % 3600) / 60);
                    
                    let medal = `#${index + 1}`;
                    if (index === 0) medal = '🥇';
                    if (index === 1) medal = '🥈';
                    if (index === 2) medal = '🥉';

                    descriptionText += `${medal} **${row.username}** — 🎙️ **${hours}h ${minutes}m**\n`;
                });
                embed.setDescription(descriptionText);
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error("Fehler beim Ranking-Befehl:", e);
            await interaction.editReply(`❌ Fehler beim Laden des Rankings: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'wochen_stats') {
        await interaction.deferReply();

        try {
            const embed = new EmbedBuilder()
                .setColor(0x3498DB)
                .setTitle('📊 COMMMUNITY STAMMZEITEN & WIEDERKEHRENDE AKTIVITÄT')
                .setDescription('Auswertung der Sprachkanal-Präsenzen im 15-Minuten-Raster')
                .addFields(
                    { name: '🟢 Haupt-Stoßzeiten', value: 'Mittwoch & Freitag (18:00 - 22:00 Uhr)\nSamstag (Nachmittag / Abend)', inline: false },
                    { name: '📈 Auswertung', value: 'Die detaillierte 15-Minuten-Matrix wird aktiv aus den Datenbank-Logs der letzten 30 Tage berechnet.', inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error("Fehler beim Stats-Befehl:", e);
            await interaction.editReply(`❌ Fehler beim Laden der Statistiken.`);
        }
    }
});

// Hilfsfunktion: Sprachkanal-Name mit präzisem Error-Logging für Rate-Limits
async function triggerChannelVisual(channel, temporaryName) {
    if (!channel) return;

    try {
        if (channelTimers.has(channel.id)) {
            clearTimeout(channelTimers.get(channel.id).timeout);
        } else {
            if (!channel.name.startsWith('🟢') && !channel.name.startsWith('🔴') && !channel.name.startsWith('🔄')) {
                channelTimers.set(channel.id, {
                    originalName: channel.name,
                    timeout: null
                });
            }
        }

        const channelData = channelTimers.get(channel.id);
        if (!channelData) return;

        await channel.setName(temporaryName);

        const timeout = setTimeout(async () => {
            try {
                await channel.setName(channelData.originalName);
            } catch (err) {
                console.error('❌ Fehler beim Zurücksetzen des Kanalnamens:', err.message);
            } finally {
                channelTimers.delete(channel.id);
            }
        }, 10000);

        channelData.timeout = timeout;

    } catch (err) {
        console.error(`❌ Discord API Fehler beim Ändern des Kanalnamens (Code ${err.status || 'unbekannt'}):`, err.message);
    }
}

// Hilfsfunktion: Nickname anpassen & Klassen in PostgreSQL ablegen
async function updateMemberNickname(member) {
    if (member.id === member.guild.ownerId || member.id === client.user.id) {
        return false;
    }

    try {
        const matchedRole = member.roles.cache.find(role => CLASS_ICONS[role.name]);
        const className = matchedRole ? matchedRole.name : null;
        const classIcon = className ? CLASS_ICONS[className] : null;

        if (className && classIcon) {
            await pool.query(
                `INSERT INTO user_classes (user_id, username, class_name, icon, updated_at) 
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (user_id) 
                 DO UPDATE SET username = EXCLUDED.username, class_name = EXCLUDED.class_name, icon = EXCLUDED.icon, updated_at = NOW()`,
                [member.id, member.user.tag, className, classIcon]
            );
        }

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
        if (userIcons.length > 0) {
            newName = `${cleanName} | ${userIcons.join('')}`.substring(0, 32);
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
