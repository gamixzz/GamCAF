const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return {
    token: '',
    protectedRoleIds: [],
    logChannelId: '',
    warnLimit: 2,
    muteDuration: 10,
  };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();

const warnings = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot connected: ${client.user.tag}`);
  console.log(`🛡️ Protected roles: ${config.protectedRoleIds.length > 0 ? config.protectedRoleIds.join(', ') : 'none'}`);
  client.user.setActivity('🛡️ Role Protection', { type: 3 });
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  config = loadConfig();

  if (config.protectedRoleIds.length === 0) return;
  if (message.mentions.users.size === 0) return;

  for (const [userId] of message.mentions.users) {
    if (userId === message.author.id) continue;

    const member = await message.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;

    const isProtected = config.protectedRoleIds.some(id => member.roles.cache.has(id));
    if (!isProtected) continue;

    await message.delete().catch(() => {});

    const key = `${message.guild.id}-${message.author.id}`;
    const currentWarns = (warnings.get(key) || 0) + 1;
    warnings.set(key, currentWarns);

    const remaining = config.warnLimit - currentWarns;

    const embed = new EmbedBuilder()
      .setColor(currentWarns >= config.warnLimit ? 0xFF0000 : 0xFF6B00)
      .setTitle(currentWarns >= config.warnLimit ? '🔇 Muted' : '⚠️ Ping not allowed')
      .setDescription(
        currentWarns >= config.warnLimit
          ? `<@${message.author.id}> has been **muted for ${config.muteDuration} minutes** for repeatedly pinging a protected member.`
          : `<@${message.author.id}>, you cannot **mention** someone with a protected role!\n\n⚠️ Warning **${currentWarns}/${config.warnLimit}**${remaining > 0 ? ` — ${remaining} more warning(s) before mute.` : ''}`
      )
      .setFooter({ text: `Role Protection • ${new Date().toLocaleTimeString('en-US')}` })
      .setTimestamp();

    const warning = await message.channel.send({ embeds: [embed] });
    setTimeout(() => warning.delete().catch(() => {}), 8000);

    if (currentWarns >= config.warnLimit) {
      warnings.set(key, 0);

      const authorMember = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (authorMember) {
        const botMember = message.guild.members.me;
        if (botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
          await authorMember.timeout(config.muteDuration * 60 * 1000, 'Repeatedly pinged a protected role member').catch(() => {});
        }
      }
    }

    if (config.logChannelId) {
      const logChannel = message.guild.channels.cache.get(config.logChannelId);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📋 Log — Forbidden Ping')
          .addFields(
            { name: 'Author', value: `<@${message.author.id}> (${message.author.tag})`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Pinged Member', value: `<@${userId}>`, inline: true },
            { name: 'Warnings', value: `${currentWarns}/${config.warnLimit}`, inline: true },
            { name: 'Muted', value: currentWarns >= config.warnLimit ? `Yes (${config.muteDuration} min)` : 'No', inline: true },
            { name: 'Deleted Message', value: `\`${message.content.substring(0, 100)}\`` },
          )
          .setTimestamp();
        logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    break;
  }
});

client.login(config.token)
