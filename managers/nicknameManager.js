// managers/nicknameManager.js
const CLASS_ICONS = {
    "Mage": "🔥",
    "Templer": "🛡️",
    "Gladiator": "⚔️",
    "Assasine": "🗡️",
    "Bogenschütze": "🏹",
    "Beschwörer": "👻",
    "Kleriker": "❤️",
    "Kantor": "🔱"
};

const WARNING_ICONS = ".⚠️⚠️⚠️";
const ALL_ICONS_ARRAY = [...Object.values(CLASS_ICONS), WARNING_ICONS, ".⚠️⚠️⚠️", "⚠️", "."];

const activeVoiceTimers = new Map();

class NicknameManager {
    constructor() {
        this.name = "NicknameManager";
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const justJoinedVoice = !oldState.channelId && newState.channelId;
        const switchedChannel = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

        if (justJoinedVoice || switchedChannel) {
            if (activeVoiceTimers.has(member.id)) {
                clearTimeout(activeVoiceTimers.get(member.id));
                activeVoiceTimers.delete(member.id);
            }

            console.log(`⚠️ [NICKNAME] Setze .⚠️⚠️⚠️ für ${member.user.tag}`);
            await this.updateMemberNickname(member, true);

            const timer = setTimeout(async () => {
                activeVoiceTimers.delete(member.id);
                console.log(`⏱️ [NICKNAME] Timer abgelaufen für ${member.user.tag}, entferne .⚠️⚠️⚠️.`);
                await this.updateMemberNickname(member, false);
            }, 10 * 1000);

            activeVoiceTimers.set(member.id, timer);
        }
    }

    async updateMemberNickname(member, showWarning = false) {
        const client = member.client;
        if (member.id === member.guild.ownerId || member.id === client.user.id) {
            return false;
        }

        try {
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

            if (showWarning) {
                newName = `${WARNING_ICONS} ${cleanName}`.substring(0, 32);
            } else {
                if (userIcons.length > 0) {
                    newName = `${cleanName} | ${userIcons.join('')}`.substring(0, 32);
                }
            }

            if (member.displayName !== newName) {
                await member.setNickname(newName);
                console.log(`✅ [NICKNAME] Nickname für ${member.user.tag} geändert zu: ${newName}`);
                return true;
            }
        } catch (e) {
            if (e.code !== 50013) {
                console.error(`❌ [NICKNAME ERROR] ${member.user.tag}:`, e.message);
            }
        }
        return false;
    }
}

module.exports = new NicknameManager();
