// index.js - Version 5.1 (Senior Programming Partner - Strikte Trennung: Join=Nickname, Leave=Channel)
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

// Maps zur Timer-Verwaltung
const activeChannelResets = new Map();
const activeNicknameResets = new Map();

process.on('unhandledRejection', error => {
    console.error('⚠️ [FATAL] Unbehandeltes Promise-Rejection abgefangen:', error);
});

client.once('clientReady', async () => {
    console.log(`✅ [INIT] Bot online als ${client.user.tag}`);
    await initDatabase();

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS channel_references (
                channel_id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL
            )
        `);
        console.log(`✅ [DB] Tabelle 'channel_references' erfolgreich geprüft/erstellt.`);
    } catch (e) {
        console.error("❌ [DB-FEHLER] Konnte channel_references Tabelle nicht erstellen:", e);
    }

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
                .setDescription('Zeigt die Sprachaktivitäts-Statistik und Stammzeiten'),
            new SlashCommandBuilder()
                .setName('save_channel_refs')
                .setDescription('Speichert alle aktuellen Sprachkanal-Namen als feste Referenz in der DB')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
            new SlashCommandBuilder()
                .setName('reset_channel_refs')
                .setDescription('Setzt alle Sprachkanäle sofort manuell auf ihre DB-Referenz zurück')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ [DISCORD] Slash-Commands erfolgreich registriert.');
    } catch (error) {
        console.error("❌ [DISCORD-FEHLER] Fehler beim Registrieren der Befehle:", error);
    }

    // WATCHDOG: Prüft alle 30 Sekunden, ob Kanäle hängen geblieben sind
    setInterval(async () => {
        try {
            const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
            if (result.rows.length === 0) return;

            for (const row of result.rows) {
                const channel = client.channels.cache.get(row.channel_id);
                if (channel && channel.isVoiceBased()) {
                    // Wenn kein aktiver Reset-Timer läuft, aber der Name ein Status-Prefix hat -> hart korrigieren
                    if (!activeChannelResets.has(row.channel_id) && (channel.name.startsWith('🔴') || channel.name.startsWith('🟢') || channel.name.startsWith('🔄'))) {
                        console.log(`🛠️ [WATCHDOG] Korrigiere hängengebliebenen Kanal ID ${row.channel_id} ('${channel.name}') -> Referenz: '${row.original_name}'`);
                        await channel.setName(row.original_name);
                    }
                }
            }
        } catch (err) {
            console.error("❌ [WATCHDOG-FEHLER] Fehler im Channel-Watchdog:", err);
        }
    }, 30000);
});

// Event: Voice State Update mit strikter Trennung
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const userId = member.id;
    const username = member.user.tag;
    const displayName = member.displayName;
    
    const justJoinedVoice = !oldState.channelId && newState.channelId;
    const justLeftVoice = oldState.channelId && !newState.channelId;
    const switchedVoice = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

    if (justJoinedVoice) {
        console.log(`🎙️ [VOICE JOIN] ${displayName} hat Kanal ID ${newState.channelId} betreten.`);
        activeVoiceSessions.set(userId, new Date());
        
        // Regel 1: User betritt -> Nickname für 10s auf ⚠️⚠️⚠️UserXY setzen
        await triggerNicknameAlert(member, `⚠️⚠️⚠️${displayName}`);
    } 
    else if (justLeftVoice) {
        console.log(`🎙️ [VOICE LEAVE] ${displayName} hat Kanal ID ${oldState.channelId} verlassen.`);
        
        await saveAndClearSession(userId, username);

        // Regel 2: User verlässt -> Kanalname für 10s auf 🔴UserXY ging setzen
        await triggerChannelLeaveAlert(oldState.channel, `🔴${displayName} ging`);
    } 
    else if (switchedVoice) {
        console.log(`🎙️ [VOICE SWITCH] ${displayName} gewechselt von ID ${oldState.channelId} zu ID ${newState.channelId}.`);
        
        await saveAndClearSession(userId, username);

        // Beim Switch: Alten Kanal als "ging" markieren UND den User-Nickname kurz aufleuchten lassen
        await triggerChannelLeaveAlert(oldState.channel, `🔴${displayName} ging`);
        await triggerNicknameAlert(member, `⚠️⚠️⚠️${displayName}`);
    }
});

// Event: Slash Commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'save_channel_refs') {
        await interaction.deferReply({ flags: [64] });

        try {
            const guild = interaction.guild;
            const channels = guild.channels.cache.filter(c => c.isVoiceBased());
            let count = 0;

            for (const [_, channel] of channels) {
                let cleanName = channel.name;
                if (cleanName.startsWith('🔴')) {
                    cleanName = cleanName.replace(/^🔴.*?\s+ging$/, '').trim();
                }

                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2)
                     ON CONFLICT (channel_id) DO UPDATE SET original_name = EXCLUDED.original_name`,
                    [channel.id, cleanName || "Voice Channel"]
                );
                count++;
            }

            await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich in der Datenbank gespeichert![cite: 3]`);
        } catch (e) {
            console.error("❌ [REFS-FEHLER]:", e);
            await interaction.editReply(`❌ Fehler: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'reset_channel_refs') {
        await interaction.deferReply({ flags: [64] });

        try {
            const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
            if (result.rows.length === 0) {
                await interaction.editReply(`❌ Keine Kanal-Referenzen gefunden. Nutze zuerst /save_channel_refs.`);
                return;
            }

            let resetCount = 0;
            for (const row of result.rows) {
                if (activeChannelResets.has(row.channel_id)) {
                    clearTimeout(activeChannelResets.get(row.channel_id));
                    activeChannelResets.delete(row.channel_id);
                }

                const channel = interaction.guild.channels.cache.get(row.channel_id);
                if (channel && channel.isVoiceBased()) {
                    try {
                        await channel.setName(row.original_name);
                        resetCount++;
                        console.log(`🛠️ [MANUAL RESET] Kanal ID ${row.channel_id} auf '${row.original_name}' zurückgesetzt.[cite: 3]`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (err) {
                        console.error(`❌ [DISCORD API] Konnte Kanal ${row.channel_id} nicht umbenennen:`, err.message);
                    }
                }
            }

            await interaction.editReply(`✅ **${resetCount}** Sprachkanäle wurden zurückgesetzt!`);
        } catch (e) {
            console.error("❌ [RESET-FEHLER]:", e);
            await interaction.editReply(`❌ Fehler beim Zurücksetzen: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'sync_nicknames') {
        await interaction.deferReply({ flags: [64] });
        try {
            const members = await interaction.guild.members.fetch();
            let updatedCount = 0;
            for (const [_, member] of members) {
                if (member.user.bot) continue;
                const changed = await updateMemberClassNickname(member);
                if (changed) updatedCount++;
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder aktualisiert.`);
        } catch (e) {
            await interaction.editReply(`❌ Ein Fehler ist aufgetreten: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'ranking_aries') {
        await interaction.deferReply();
        try {
            const result = await pool.query(`SELECT username, SUM(duration_seconds) as total_seconds FROM voice_sessions GROUP BY username ORDER BY total_seconds DESC LIMIT 10`);
            const embed = new EmbedBuilder().setColor(0x00AE86).setTitle('🏆 ARIES COMMUNITY - VOICE RANKING').setTimestamp();
            if (result.rows.length === 0) {
                embed.addFields({ name: 'Keine Daten', value: 'Keine Voice-Zeiten aufgezeichnet.' });
            } else {
                let desc = '';
                result.rows.forEach((row, i) => {
                    const h = Math.floor(row.total_seconds / 3600);
                    const m = Math.floor((row.total_seconds % 3600) / 60);
                    desc += `#${i + 1} **${row.username}** — 🎙️ **${h}h ${m}m**\n`;
                });
                embed.setDescription(desc);
            }
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            await interaction.editReply(`❌ Fehler: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'wochen_stats') {
        await interaction.deferReply();
        const embed = new EmbedBuilder().setColor(0x3498DB).setTitle('📊 COMMMUNITY STAMMZEITEN').setDescription('Auswertung aktiv.').setTimestamp();
        await interaction.editReply({ embeds: [embed] });
    }
});

// Hilfsfunktion: Session speichern und löschen
async function saveAndClearSession(userId, username) {
    const joinTime = activeVoiceSessions.get(userId);
    if (joinTime) {
        const leaveTime = new Date();
        const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);

        if (durationSeconds > 0) {
            try {
                await pool.query(
                    `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                    [userId, username, joinTime, leaveTime, durationSeconds]
                );
            } catch (err) {
                console.error('❌ [DB-FEHLER] Fehler beim Speichern der Voice-Session:', err);
            }
        }
        activeVoiceSessions.delete(userId);
    }
}

// Hilfsfunktion: Originalen Kanalnamen aus DB holen
async function getOriginalChannelName(channelId) {
    try {
        const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [channelId]);
        if (res.rows.length > 0) {
            return res.rows[0].original_name;
        }
    } catch (e) {
        console.error("❌ [DB-FEHLER] Konnte Kanal-Referenz nicht abrufen:", e);
    }
    return "Voice Channel";
}

// 1. Nickname-Alarm (Beim Betreten) für 10 Sekunden
async function triggerNicknameAlert(member, alertName) {
    try {
        if (activeNicknameResets.has(member.id)) {
            clearTimeout(activeNicknameResets.get(member.id));
        }

        await member.setNickname(alertName.substring(0, 32));
        console.log(`🏷️ [NICKNAME ALERT] ${member.user.tag} temporär auf '${alertName}' gesetzt.`);

        const timeout = setTimeout(async () => {
            try {
                await updateMemberClassNickname(member);
                console.log(`🏷️ [NICKNAME RESET] ${member.user.tag} auf Klassen-Nickname zurückgesetzt.`);
            } catch (err) {
                console.error(`❌ [NICKNAME RESET FEHLER]:`, err.message);
            } finally {
                activeNicknameResets.delete(member.id);
            }
        }, 10000);

        activeNicknameResets.set(member.id, timeout);
    } catch (e) {
        console.error(`❌ [NICKNAME FEHLER]:`, e.message);
    }
}

// 2. Kanal-Leave-Alarm (Beim Verlassen) für 10 Sekunden
async function triggerChannelLeaveAlert(channel, alertChannelName) {
    if (!channel) return;

    try {
        if (activeChannelResets.has(channel.id)) {
            clearTimeout(activeChannelResets.get(channel.id));
        }

        const originalName = await getOriginalChannelName(channel.id);

        await channel.setName(alertChannelName.substring(0, 32));
        console.log(`🔴 [CHANNEL LEAVE ALERT] Kanal ID ${channel.id} auf '${alertChannelName}' gesetzt.`);

        const timeout = setTimeout(async () => {
            try {
                const freshChannel = channel.guild.channels.cache.get(channel.id);
                if (freshChannel) {
                    await freshChannel.setName(originalName);
                    console.log(`✨ [CHANNEL RESET] Kanal ID ${channel.id} auf Original '${originalName}' zurückgesetzt.`);
                }
            } catch (err) {
                console.error(`❌ [CHANNEL RESET FEHLER]:`, err.message);
            } finally {
                activeChannelResets.delete(channel.id);
            }
        }, 10000);

        activeChannelResets.set(channel.id, timeout);
    } catch (e) {
        console.error(`❌ [CHANNEL LEAVE FEHLER]:`, e.message);
    }
}

// Normaler Klassen-Nickname (Standard-Zustand)
async function updateMemberClassNickname(member) {
    if (member.id === member.guild.ownerId || member.id === client.user.id) return false;
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

        let cleanName = member.user.username;
        let newName = cleanName;
        if (userIcons.length > 0) {
            newName = `${cleanName} | ${userIcons.join('')}`.substring(0, 32);
        }

        if (member.displayName !== newName) {
            await member.setNickname(newName);
            return true;
        }
    } catch (e) {
        console.error(`❌ [CLASS NICKNAME FEHLER]:`, e.message);
    }
    return false;
}

client.login(process.env.DISCORD_TOKEN);
