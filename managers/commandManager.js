else if (interaction.commandName === 'sync_nicknames') {
                await interaction.deferReply({ flags: [64] });
                const members = await interaction.guild.members.fetch();
                let updatedCount = 0;
                for (const [_, member] of members) {
                    if (member.user.bot) continue;
                    // Hier explizit false übergeben, damit keine Warnung erzwungen wird!
                    const changed = await nicknameManager.updateMemberNickname(member, false);
                    if (changed) {
                        updatedCount++;
                        await new Promise(r => setTimeout(r, 100));
                    }
                }
                await interaction.editReply(`✅ Nicknames für **${updatedCount}** Mitglieder synchronisiert.`);
            }
