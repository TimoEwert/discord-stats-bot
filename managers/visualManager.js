// managers/visualManager.js
const { pool } = require('../database');
const activeChannelResets = new Map();

class VisualManager {
    constructor() {
        this.name = "VisualManager";
    }

    async handleLeave(oldChannel, member) {
        if (!oldChannel) return;

        try {
            if (activeChannelResets.has(oldChannel.id)) {
                clearTimeout(activeChannelResets.get(oldChannel.id));
                activeChannelResets.delete(oldChannel.id);
            }

            // Hole den echten Originalnamen aus der DB (niemals vom aktuellen Namen ableiten, um Verschmelzungen zu verhindern!)
            let originalName = "Voice Channel";
            try {
                const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
                if (res.rows.length > 0) {
                    originalName = res.rows[0].original_name;
                } else {
                    // Fallback: Säubere jegliche roten Präfixe
                    originalName = oldChannel.name.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                }
            } catch (e) {
                originalName = "Voice Channel";
            }

            const alertName = `🔴${member.user.username} ging`.substring(0, 32);
            await oldChannel.setName(alertName);
            console.log(`🔴 [VISUAL] Kanal ID ${oldChannel.id} auf '${alertName}' gesetzt.`);

            const timeout = setTimeout(async () => {
                try {
                    const freshChannel = oldChannel.guild.channels.cache.get(oldChannel.id);
                    if (freshChannel) {
                        await freshChannel.setName(originalName);
                        console.log(`✨ [VISUAL RESET] Kanal ID ${oldChannel.id} auf Original '${originalName}' zurückgesetzt.`);
                    }
                } catch (err) {
                    console.error(`❌ [VISUAL RESET ERROR]:`, err.message);
                } finally {
                    activeChannelResets.delete(oldChannel.id);
                }
            }, 10000);

            activeChannelResets.set(oldChannel.id, timeout);
        } catch (e) {
            console.error(`❌ [VISUAL ERROR]:`, e.message);
        }
    }
}

module.exports = new VisualManager();
