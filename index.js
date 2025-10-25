require('dotenv').config(); // load .env

const { Client, GatewayIntentBits } = require('discord.js');

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Read token from environment variable
const TOKEN = process.env.DISCORD_TOKEN;

// helper: find the 'bot-warning' text channel in a guild and send a short message
async function notifyBotWarning(guild, content) {
  try {
    if (!guild) return;
    const channel = guild.channels.cache.find(ch => ch.name === 'bot-warning' && typeof ch.send === 'function');
    if (!channel) return;
    await channel.send(content);
  } catch (err) {
    console.error('Failed to send bot-warning message:', err);
  }
}

// helper: fetch the latest audit log entry for the guild
async function fetchLatestAuditEntry(guild) {
  try {
    const logs = await guild.fetchAuditLogs({ limit: 1 });
    return logs.entries.first();
  } catch (err) {
    console.error('Failed to fetch audit logs:', err);
    return null;
  }
}

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// Role events
client.on('roleCreate', async (role) => {
  const entry = await fetchLatestAuditEntry(role.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(role.guild, `:warning: Role created: **${role.name}** — by **${executor}** | ${reason}`);
});

client.on('roleDelete', async (role) => {
  const entry = await fetchLatestAuditEntry(role.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(role.guild, `:warning: Role deleted: **${role.name}** — by **${executor}** | ${reason}`);
});

client.on('roleUpdate', async (oldRole, newRole) => {
  const entry = await fetchLatestAuditEntry(newRole.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newRole.guild, `:warning: Role updated: **${oldRole.name}** → **${newRole.name}** — by **${executor}** | ${reason}`);
});

// Channel events
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Channel created: **${channel.name}** — by **${executor}** | ${reason}`);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Channel deleted: **${channel.name}** — by **${executor}** | ${reason}`);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const entry = await fetchLatestAuditEntry(newChannel.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newChannel.guild, `:warning: Channel updated: **${oldChannel.name || oldChannel.id}** — by **${executor}** | ${reason}`);
});

// Webhook update
client.on('webhookUpdate', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Webhooks updated in channel **${channel.name}** — by **${executor}** | ${reason}`);
});

// Bans and guild updates
client.on('guildBanAdd', async (guild, user) => {
  const entry = await fetchLatestAuditEntry(guild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(guild, `:warning: Member banned: **${user.tag}** — by **${executor}** | ${reason}`);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
  const entry = await fetchLatestAuditEntry(newGuild);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newGuild, `:warning: Guild updated — by **${executor}** | ${reason}`);
});

// Simple command handler preserved
client.on('messageCreate', (message) => {
  if (message.content === '!ping') {
    message.reply('🏓 Pong!');
  }
});

// Login (single call)
client.login(TOKEN).then(() => {
  console.log('Bot logged in!');
}).catch(err => {
  console.error('Login failed:', err);
});
