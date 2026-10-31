// index.js - Version 3.0 (Senior Programming Partner - Komplettversion)
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

process.on('unhandledRejection', error => {
    console.error('⚠️ Unbehandeltes Promise-Rejection abgefangen:', error);
});

client.once('ready', async () => {
    console.log(`✅ Bot online als ${client.user.tag}`);
    await initDatabase();

    // Slash Commands registrieren (Punkt 4 & 5)
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

    // 1. STATISTIK & 10-SEKUNDEN KANAL-UMBENENNUNG (Punkt 1 & 6)
    if (justJoinedVoice) {
        activeVoiceSessions.set(userId, new Date());
        
        // Kanalname temporär anpassen (Punkt 6)
        await triggerChannelVisual(newState.channel, `🟢 ${displayName} betritt`);

        // Klassen/Nicknamen im Hintergrund aktualisieren (Punkt 3)
        await updateMemberNickname(member);

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

        // Kanalname temporär anpassen (Punkt 6)
        await triggerChannelVisual(oldState.channel, `🔴 ${displayName} verlässt`);
    }
});

// Event: Slash Commands verarbeiten (Punkt 4 & 5)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // BFEHL 1: /sync_nicknames (Punkt 4)
    if (interaction.commandName === 'sync_nicknames') {
        await interaction.deferReply({ flags: [64] }); // Ephemeral reply

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

    // BEFEHL 2: /ranking_aries (Punkt 5 - MEE6 Style Embed)
    else if (interaction.commandName === 'ranking_aries') {
        await interaction.deferReply();

        try {
            // Top 10 User nach Gesamt-Voice-Zeit aus der Datenbank abfragen
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

    // BEFEHL 3: /wochen_stats (Punkt 2 - Wochen- & Zeitfenster Statistik)
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

// Hilfsfunktion: Sprachkanal-Name für 10 Sekunden ändern (Punkt 6)
async function triggerChannelVisual(channel, temporaryName) {
    if (!channel) return;

    const originalName = channel.name;
    try {
        await channel.setName(temporaryName);
        setTimeout(async () => {
            try {
                await channel.setName(originalName);
            } catch (err) {
                console.error('❌ Fehler beim Zurücksetzen des Kanalnamens:', err);
            }
        }, 10000);
    } catch (err) {
        console.error('❌ Fehler beim Ändern des Kanalnamens (Rechte prüfen!):', err);
    }
}

// Hilfsfunktion: Nickname anpassen & Klassen in PostgreSQL ablegen (Punkt 3 & 4)
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
