// managers/nicknameManager.js
const CLASS_ICONS = {
    "Magier": "🔥", "Templer": "🛡️", "Gladiator": "⚔️", "Assasine": "🗡️",
    "Waldläufer": "🏹", "Beschwörer": "👻", "Kleriker": "❤️", "Kantor": "🔱"
};

class NicknameManager {
    constructor() {
        this.name = "NicknameManager";
    }

    async updateMemberNickname(member, client) {
        if (member.id === member.guild.ownerId || member.id === client.user.id) return false;
        try {
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
            if (e.code !== 50013) {
                console.error(`❌ [NICKNAME ERROR]:`, e.message);
            }
        }
        return false;
    }
}

module.exports = new NicknameManager();
