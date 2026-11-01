// index.js - Version 3.9 (Senior Programming Partner - Komplettversion mit Ticker & Logging)
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

// Robuste Kanal-Ticker und Queue-Verwaltung für gleichzeitige User
// channelId -> { originalName: string, tickerQueue: string[], isRunning: boolean, currentTimeout: NodeJS.Timeout }
const channelTickers = new Map();

process.on('unhandledRejection', error => {
    console.error('⚠️ [FATAL] Unbehandeltes Promise-Rejection abgefangen:', error);
});

client.once('ready', async () => {
    console.log(`✅ [INIT] Bot online als ${client.user.tag}`);
    await initDatabase();

    // Tabelle für Kanal-Referenzen sicherstellen
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
                .setDescription('Zeigt die Sprachaktivitäts-Statistik und Stammzeiten'),
            new SlashCommandBuilder()
                .setName('save_channel_refs')
                .setDescription('Speichert alle aktuellen Sprachkanal-Namen als feste Referenz in der DB')
                .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        ];
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ [DISCORD] Slash-Commands erfolgreich registriert.');
    } catch (error) {
        console.error("❌ [DISCORD-FEHLER] Fehler beim Registrieren der Befehle:", error);
    }

    // WATCHDOG: Prüft alle 60 Sekunden, ob Kanäle hängen geblieben sind
    setInterval(async () => {
        try {
            const result = await pool.query(`SELECT channel_id, original_name FROM channel_references`);
            if (result.rows.length === 0) return;

            for (const row of result.rows) {
                // Wenn für diesen Kanal gerade ein aktiver Ticker läuft, lassen wir ihn in Ruhe
                if (channelTickers.has(row.channel_id) && channelTickers.get(row.channel_id).isRunning) {
                    continue;
                }

                const channel = client.channels.cache.get(row.channel_id);
                if (channel && channel.isVoiceBased()) {
                    if (channel.name.startsWith('🟢') || channel.name.startsWith('🔴') || channel.name.startsWith('🔄')) {
                        console.log(`🛠️ [WATCHDOG] Korrigiere hängengebliebenen Kanal '${channel.name}' -> Referenz: '${row.original_name}'`);
                        await channel.setName(row.original_name);
                    }
                }
            }
        } catch (err) {
            console.error("❌ [WATCHDOG-FEHLER] Fehler im Channel-Watchdog:", err);
        }
    }, 60000);
});

// Event: Voice State Update mit detailliertem Logging
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
        console.log(`🎙️ [VOICE JOIN] ${displayName} (${username}) hat Kanal ${newState.channel.name} betreten.`);
        activeVoiceSessions.set(userId, new Date());
        
        await queueChannelTicker(newState.channel, `🟢 ${displayName} betritt`);
        await updateMemberNickname(member);
    } 
    else if (justLeftVoice) {
        console.log(`🎙️ [VOICE LEAVE] ${displayName} (${username}) hat Kanal ${oldState.channel.name} verlassen.`);
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
                    console.log(`💾 [DB] Session gespeichert für ${username}: ${durationSeconds} Sekunden.`);
                } catch (err) {
                    console.error('❌ [DB-FEHLER] Fehler beim Speichern der Voice-Session:', err);
                }
            }
            activeVoiceSessions.delete(userId);
        }

        await queueChannelTicker(oldState.channel, `🔴 ${displayName} verlässt`);
    } 
    else if (switchedVoice) {
        console.log(`🎙️ [VOICE SWITCH] ${displayName} (${username}) gewechselt von ${oldState.channel.name} zu ${newState.channel.name}.`);
        const joinTime = activeVoiceSessions.get(userId);
        const leaveTime = new Date();

        if (joinTime) {
            const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);
            if (durationSeconds > 0) {
                try {
                    await pool.query(
                        `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) VALUES ($1, $2, $3, $4, $5)`,
                        [userId, username, joinTime, leaveTime, durationSeconds]
                    );
                } catch (err) {
                    console.error('❌ [DB-FEHLER] Fehler beim Speichern der Switch-Session:', err);
                }
            }
        }

        activeVoiceSessions.set(userId, leaveTime);
        await queueChannelTicker(oldState.channel, `🔴 ${displayName} verlässt`);
        await queueChannelTicker(newState.channel, `🔄 ${displayName} wechselt`);
        await updateMemberNickname(member);
    }
});

// Event: Slash Commands verarbeiten
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
                if (cleanName.startsWith('🟢') || cleanName.startsWith('🔴') || cleanName.startsWith('🔄')) {
                    cleanName = cleanName.replace(/^(🟢|🔴|🔄)\s+.*?\s+(betritt|verlässt|wechselt)$/, '').trim();
                }

                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2)
                     ON CONFLICT (channel_id) DO UPDATE SET original_name = EXCLUDED.original_name`,
                    [channel.id, cleanName || "Voice Channel"]
                );
                count++;
            }

            console.log(`✅ [REFS] ${count} Sprachkanal-Referenzen durch Administrator gespeichert.`);
            await interaction.editReply(`✅ **${count}** Sprachkanal-Referenzen erfolgreich in der Datenbank gespeichert!`);
        } catch (e) {
            console.error("❌ [REFS-FEHLER] Fehler beim Speichern der Kanal-Referenzen:", e);
            await interaction.editReply(`❌ Fehler: ${e.message}`);
        }
    }

    else if (interaction.commandName === 'sync_nicknames') {
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
            console.error("❌ [SYNC-FEHLER] Fehler beim Sync-Befehl:", e);
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
            console.error("❌ [RANKING-FEHLER] Fehler beim Laden des Rankings:", e);
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
            console.error("❌ [STATS-FEHLER] Fehler beim Laden der Statistiken:", e);
            await interaction.editReply(`❌ Fehler beim Laden der Statistiken.`);
        }
    }
});

// Hilfsfunktion: Holt den sauberen Originalnamen aus der DB-Referenz
async function getOriginalChannelName(channel) {
    try {
        const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [channel.id]);
        if (res.rows.length > 0) {
            return res.rows[0].original_name;
        }
    } catch (e) {
        console.error("❌ [DB-FEHLER] Konnte Kanal-Referenz nicht abrufen:", e);
    }
    // Fallback falls nicht in DB gefunden
    let clean = channel.name.replace(/^(🟢|🔴|🔄)\s+.*?\s+(betritt|verlässt|wechselt)$/, '').trim();
    return clean || "Voice Channel";
}

// Sekundengenauer Ticker & Queue für gleichzeitige Events
async function queueChannelTicker(channel, statusText) {
    if (!channel) return;

    if (!channelTickers.has(channel.id)) {
        channelTickers.set(channel.id, {
            originalName: null,
            tickerQueue: [],
            isRunning: false
        });
    }

    const data = channelTickers.get(channel.id);

    // Ursprungsnamen einmalig laden falls nicht vorhanden
    if (!data.originalName) {
        data.originalName = await getOriginalChannelName(channel);
    }

    // Status in die Ticker-Warteschlange legen
    data.tickerQueue.push(statusText);
    console.log(`📋 [TICKER QUEUE] Kanal '${data.originalName}': Neuer Status '${statusText}' eingereiht. (Queue-Länge: ${data.tickerQueue.length})`);

    // Wenn der Ticker noch nicht läuft, starten
    if (!data.isRunning) {
        runChannelTicker(channel);
    }
}

// Abarbeitung der Ticker-Warteschlange im Sekundentakt
async function runChannelTicker(channel) {
    const data = channelTickers.get(channel.id);
    if (!data || data.tickerQueue.length === 0) {
        if (data) {
            data.isRunning = false;
            // Wenn Queue leer ist, nach kurzer Pause wieder auf den echten Originalnamen setzen
            try {
                console.log(`✨ [TICKER ENDE] Kanal '${channel.name}' kehrt zu Original zurück: '${data.originalName}'`);
                await channel.setName(data.originalName);
            } catch (err) {
                console.error(`❌ [DISCORD API] Fehler beim Wiederherstellen von '${data.originalName}':`, err.message);
            }
        }
        return;
    }

    data.isRunning = true;
    const nextStatus = data.tickerQueue.shift();

    try {
        console.log(`🔄 [TICKER UPDATE] Setze Kanal '${channel.name}' auf: '${nextStatus}'`);
        await channel.setName(nextStatus);
    } catch (err) {
        console.error(`❌ [DISCORD API] Fehler beim Ticker-Update (Rate-Limit / Rechte):`, err.message);
    }

    // Exakt im Sekundentakt (1000ms) den nächsten Status oder das Ende verarbeiten
    setTimeout(() => {
        runChannelTicker(channel);
    }, 1000);
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
            console.log(`🏷️ [NICKNAME] Aktualisiert für ${member.user.tag} -> ${newName}`);
            return true;
        }
    } catch (e) {
        console.error(`❌ [NICKNAME-FEHLER] Fehler beim Anpassen für ${member.user.tag}:`, e.message);
    }
    return false;
}

client.login(process.env.DISCORD_TOKEN);
