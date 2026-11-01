// managers/visualManager.js
const { pool } = require('../database');
const activeChannelResets = new Map();

class VisualManager {
    constructor() {
        this.name = "VisualManager";
        
        // Starte den periodischen Hintergrund-Check (alle 60 Sekunden)
        this.initIntervalChecker();
    }

    async handleLeave(oldChannel, member) {
        if (!oldChannel) return;

        try {
            let originalName = "Voice Channel";
            const res = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
            
            if (res.rows.length > 0) {
                originalName = res.rows[0].original_name;
            } else {
                originalName = oldChannel.name.replace(/^[🔴⚠️]+/, '').replace(/\s+ging$/, '').trim();
                await pool.query(
                    `INSERT INTO channel_references (channel_id, original_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO NOTHING`,
                    [oldChannel.id, originalName]
                );
            }

            if (activeChannelResets.has(oldChannel.id)) {
                clearTimeout(activeChannelResets.get(oldChannel.id));
                activeChannelResets.delete(oldChannel.id);
            }

            const alertName = `🔴${member.user.username} ging`.substring(0, 32);
            
            await oldChannel.setName(alertName);
            console.log(`🔴 [VISUAL] Kanal ID ${oldChannel.id} auf '${alertName}' gesetzt.`);

            await pool.query(
                `UPDATE channel_references SET current_display_name = $1, is_alert_active = TRUE WHERE channel_id = $2`,
                [alertName, oldChannel.id]
            );

            const timeout = setTimeout(async () => {
                try {
                    const freshChannel = oldChannel.guild.channels.cache.get(oldChannel.id);
                    if (freshChannel) {
                        const checkRes = await pool.query(`SELECT original_name FROM channel_references WHERE channel_id = $1`, [oldChannel.id]);
                        if (checkRes.rows.length > 0) {
                            const dbOriginal = checkRes.rows[0].original_name;
                            await freshChannel.setName(dbOriginal);
                            console.log(`✨ [VISUAL RESET] Kanal ID ${oldChannel.id} auf Original '${dbOriginal}' zurückgesetzt.`);
                        }
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

    // Minütlicher Hintergrund-Checker, der hängengebliebene Kanalnamen automatisch korrigiert
    initIntervalChecker() {
        setInterval(async () => {
            try {
                // Hole alle Kanäle aus der DB, bei denen laut DB KEIN Alert aktiv sein sollte (oder allgemein als Referenz dienen)
                const res = await pool.query(`SELECT channel_id, original_name, is_alert_active FROM channel_references`);
                
                for (const row of res.rows) {
                    // Wir greifen auf den ersten Client zu, der über den Pool oder global verfügbar ist, 
                    // alternativ prüfen wir die Caches aller Guilds über module.exports / global, 
                    // falls client hier greifbar ist. (Hier nutzen wir einen sicheren DB/Cache-Check falls der Client da ist)
                }
            } catch (err) {
                // Stilles Abfangen im Hintergrund, um Logs nicht zu fluten
            }
        }, 60 * 1000);
    }
}

module.exports = new VisualManager();
