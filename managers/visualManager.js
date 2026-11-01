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
            // 1. Hole den echten Originalnamen aus der DB
            let originalName = "Voice Channel";
            const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
            
            if (res.rows.length > 0) {
                originalName = res.rows[0].original_name;
            } else {
                // Fallback: Name bereinigen und direkt in die DB schreiben
                originalName = oldChannel.name.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO NOTHING`,
                    [oldChannel.id, originalName]
                );
            }

            // 2. Laufenden Timer für diesen Kanal stoppen
            if (activeChannelResets.has(oldChannel.id)) {
                clearTimeout(activeChannelResets.get(oldChannel.id));
                activeChannelResets.delete(oldChannel.id);
            }

            const alertName = `🔴${member.user.username} ging`.substring(0, 32);
            
            // 3. Kanal auf den 'ging'-Status setzen
            await oldChannel.setName(alertName);
            console.log(`🔴 [VISUAL] Kanal ID ${oldChannel.id} auf '${alertName}' gesetzt.`);

            // In DB vermerken
            await pool.query(
                `UPDATE channel_references SET current_display_name = $1, is_alert_active = TRUE WHERE channel_id = $2`,
                [alertName, oldChannel.id]
            );

            // 4. 10-Sekunden-Timer für den Rücksprung starten
            const timeout = setTimeout(async () => {
                try {
                    const freshChannel = oldChannel.guild.channels.cache.get(oldChannel.id);
                    if (freshChannel) {
                        const checkRes = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
                        const dbOriginal = checkRes.rows.length > 0 ? checkRes.rows[0].original_name : originalName;
                        
                        await freshChannel.setName(dbOriginal);
                        console.log(`✨ [VISUAL RESET] Kanal ID ${oldChannel.id} auf Original '${dbOriginal}' zurückgesetzt.`);
                    }
                    await pool.query(
                        `UPDATE channel_references SET current_display_name = NULL, is_alert_active = FALSE WHERE channel_id = $1`,
                        [oldChannel.id]
                    );
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
