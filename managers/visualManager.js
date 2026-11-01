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
                // Fallback falls noch nicht gesichert
                originalName = oldChannel.name.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO NOTHING`,
                    [oldChannel.id, originalName]
                );
            }

            // Alten Timer für diesen Kanal stoppen, falls vorhanden
            if (activeChannelResets.has(oldChannel.id)) {
                clearTimeout(activeChannelResets.get(oldChannel.id));
                activeChannelResets.delete(oldChannel.id);
            }

            const alertName = `🔴${member.user.username} ging`.substring(0, 32);
            
            // Channel umbenennen
            await oldChannel.setName(alertName);
            console.log(`🔴 [VISUAL] Kanal ID ${oldChannel.id} auf '${alertName}' gesetzt.`);

            // In DB vermerken, dass ein Alert aktiv ist
            await pool.query(
                `UPDATE channel_references SET current_display_name = $1, is_alert_active = TRUE WHERE channel_id = $2`,
                [alertName, oldChannel.id]
            );

            // 10-Sekunden-Timer starten
            const timeout = setTimeout(async () => {
                try {
                    const freshChannel = oldChannel.guild.channels.cache.get(oldChannel.id);
                    if (freshChannel) {
                        // Prüfe in der DB, ob in der Zwischenzeit ein neuerer Alert kam
                        const checkRes = await pool.query(`SELECT original_name, current_display_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
                        
                        if (checkRes.rows.length > 0) {
                            const dbOriginal = checkRes.rows[0].original_name;
                            const currentChannelName = freshChannel.name;
                            
                            // Setze nur zurück, wenn der Channel noch den Alert trägt oder wir sicher sind
                            await freshChannel.setName(dbOriginal);
                            console.log(`✨ [VISUAL RESET] Kanal ID ${oldChannel.id} auf Original '${dbOriginal}' zurückgesetzt.`);
                        }
                    }
                    // DB Status zurücksetzen
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
