// managers/visualManager.js
const { pool } = require('../database');
const activeChannelResets = new Map();

class VisualManager {
    async triggerChannelLeaveAlert(channel, alertChannelName) {
        if (!channel) return;

        try {
            if (activeChannelResets.has(channel.id)) {
                clearTimeout(activeChannelResets.get(channel.id));
                activeChannelResets.delete(channel.id);
            }

            // Originalnamen holen (mit Fallback)
            let originalName = "Voice Channel";
            try {
                const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [channel.id]);
                if (res.rows.length > 0) originalName = res.rows[0].original_name;
            } catch (e) {
                originalName = channel.name.replace(/^🔴.*?\s+ging$/, '').trim();
            }

            // Sofort umbenennen
            await channel.setName(alertChannelName.substring(0, 32));
            console.log(`🔴 [VISUAL] Kanal ID ${channel.id} auf '${alertChannelName}' gesetzt.`);

            // Nach 10 Sekunden zurücksetzen
            const timeout = setTimeout(async () => {
                try {
                    const freshChannel = channel.guild.channels.cache.get(channel.id);
                    if (freshChannel) {
                        await freshChannel.setName(originalName);
                        console.log(`✨ [VISUAL RESET] Kanal ID ${channel.id} auf '${originalName}' zurückgesetzt.`);
                    }
                } catch (err) {
                    console.error(`❌ [VISUAL RESET ERROR]:`, err.message);
                } finally {
                    activeChannelResets.delete(channel.id);
                }
            }, 10000);

            activeChannelResets.set(channel.id, timeout);
        } catch (e) {
            console.error(`❌ [VISUAL ERROR]:`, e.message);
        }
    }
}

module.exports = new VisualManager();
