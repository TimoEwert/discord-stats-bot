// managers/nicknameManager.js
const CLASS_ICONS = {
    "Magier": "🔥", "Templer": "🛡️", "Gladiator": "⚔️", "Assasine": "🗡️",
    "Waldläufer": "🏹", "Beschwörer": "👻", "Kleriker": "❤️", "Kantor": "🔱"
};

const activeNicknameResets = new Map();

class NicknameManager {
    constructor() {
        this.name = "NicknameManager";
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const justJoined = !oldState.channelId && newState.channelId;
        const switched = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

        if (justJoined || switched) {
            const currentDisplay = member.displayName.replace(/^[🔴⚠️]+/, '').trim();
            await this.triggerNicknameAlert(member, `⚠️⚠️⚠️${currentDisplay}`);
        }
    }

    async triggerNicknameAlert(member, alertName) {
        if (!member) return;
        try {
            if (activeNicknameResets.has(member.id)) {
                clearTimeout(activeNicknameResets.get(member.id));
                activeNicknameResets.delete(member.id);
            }

            if (member.id !== member.guild.ownerId && member.id !== member.client.user.id) {
                await member.setNickname(alertName.substring(0, 32));
                console.log(`🏷️ [NICKNAME ALERT] ${member.user.tag} temporär auf '${alertName}' gesetzt.`);
            }

            const timeout = setTimeout(async () => {
                try {
                    await this.updateMemberNickname(member, member.client);
                    console.log(`🏷️ [NICKNAME RESET] ${member.user.tag} auf Klassen-Nickname zurückgesetzt.`);
                } catch (err) {
                    console.error(`❌ [NICKNAME RESET ERROR]:`, err.message);
                } finally {
                    activeNicknameResets.delete(member.id);
                }
            }, 10000);

            activeNicknameResets.set(member.id, timeout);
        } catch (e) {
            if (e.code !== 50013) {
                console.error(`❌ [NICKNAME ALERT ERROR]:`, e.message);
            }
        }
    }

    async updateMemberNickname(member, client) {
        if (member.id === member.guild.ownerId || member.id === client.user.id) return false;
        try {
            const userIcons = member.roles.cache
                .filter(role => CLASS_ICONS[role.name])
                .map(role => CLASS_ICONS[role.name]);

            // Nimm den aktuellen serverspezifischen Namen als Basis und entferne jegliche alten Klassen-Anhänge (| ...) sowie Alarme
            let baseName = member.displayName
                .replace(/^[🔴⚠️]+/, '')       // Entfernt 🔴 oder ⚠️ am Anfang
                .replace(/\s*\|\s*[🔥🛡️⚔️🗡️🏹👻❤️🔱]+$/g, '') // Entfernt alte Icons am Ende
                .replace(/\s*\|.*$/, '')        // Entfernt alles ab dem Trenner |
                .trim();

            // Falls durch das Bereinigen ein leerer Name entstünde, nimm als Fallback den echten Username
            if (!baseName) {
                baseName = member.user.username;
            }

            let newName = baseName;
            if (userIcons.length > 0) {
                newName = `${baseName} | ${userIcons.join('')}`.substring(0, 32);
            }

            if (member.displayName !== newName) {
                await member.setNickname(newName);
                console.log(`✅ [NICKNAME SYNC] ${member.user.tag} behält Server-Namen und aktualisiert Klassen auf: ${newName}`);
                return true;
            }
        } catch (e) {
            if (e.code !== 50013) {
                console.error(`❌ [CLASS NICKNAME ERROR] Konnte Nickname für ${member.user.tag} nicht setzen:`, e.message);
            }
        }
        return false;
    }
}

module.exports = new NicknameManager();
