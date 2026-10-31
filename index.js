// index.js - Version 1.0 (Senior Programming Partner)
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();
const { pool, initDatabase } = require('./database');

// Client mit allen notwendigen Intents initialisieren
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// Map zur temporären Speicherung der Join-Zeiten im Arbeitsspeicher
const activeVoiceSessions = new Map();

client.once('ready', async () => {
  console.log(`🚀 Bot ist erfolgreich eingeloggt als ${client.user.tag}!`);
  // Tabellen in PostgreSQL prüfen/anlegen
  await initDatabase();
});

// Event: Voice State Update (wird bei Voice-Events wie Join, Leave oder Switch getriggert)
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = newState.member.id;
  const username = newState.member.user.tag;
  const displayName = newState.member.displayName;

  // FALL 1: User betritt einen Sprachkanal
  if (!oldState.channelId && newState.channelId) {
    // Startzeit merken
    activeVoiceSessions.set(userId, new Date());
    
    // Visuelles Feedback: Kanalname für 10 Sekunden anpassen
    await triggerChannelVisual(newState.channel, `🟢 + ${displayName} ist da!`);
  } 
  
  // FALL 2: User verlässt einen Sprachkanal komplett
  else if (oldState.channelId && !newState.channelId) {
    const joinTime = activeVoiceSessions.get(userId);
    
    if (joinTime) {
      const leaveTime = new Date();
      const durationSeconds = Math.floor((leaveTime - joinTime) / 1000);

      // Session in der Datenbank speichern
      try {
        await pool.query(
          `INSERT INTO voice_sessions (user_id, username, joined_at, left_at, duration_seconds) 
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, username, joinTime, leaveTime, durationSeconds]
        );
        console.log(`💾 Session gespeichert: ${displayName} (${durationSeconds}s)`);
      } catch (err) {
        console.error('❌ Fehler beim Speichern der Voice-Session:', err);
      }
      
      // Aus Map entfernen
      activeVoiceSessions.delete(userId);
    }

    // Visuelles Feedback: Kanalname für 10 Sekunden anpassen
    await triggerChannelVisual(oldState.channel, `🔴 - ${displayName} weg`);
  }
});

// Hilfsfunktion: Benennt den Kanal für exakt 10 Sekunden um und setzt ihn zurück
async function triggerChannelVisual(channel, temporaryName) {
  if (!channel) return;

  const originalName = channel.name;
  try {
    // Kanalnamen temporär ändern
    await channel.setName(temporaryName);

    // Nach 10 Sekunden (10.000 ms) wieder den ursprünglichen Namen setzen
    setTimeout(async () => {
      try {
        await channel.setName(originalName);
      } catch (err) {
        console.error('❌ Fehler beim Zurücksetzen des Kanalnamens:', err);
      }
    }, 10000);

  } catch (err) {
    console.error('❌ Fehler beim Ändern des Kanalnamens (Berechtigungen geprüft?):', err);
  }
}

// Bot anmelden
client.login(process.env.DISCORD_TOKEN);
