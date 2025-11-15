require('dotenv').config(); // load .env
const { Client, GatewayIntentBits, AuditLogEvent, ChannelType } = require('discord.js');
const { OpenRouter } = require('@openrouter/sdk'); // Updated: use OpenRouter SDK

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Read token and chatbot config from environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const CHATBOT_CHANNEL_NAME = process.env.CHATBOT_CHANNEL || 'bot-chat';
const HTTP_REFERER = process.env.HTTP_REFERER || 'https://your-site.com'; // Optional
const X_TITLE = process.env.X_TITLE || 'Discord Bot'; // Optional

// Initialize OpenRouter client
const openRouter = new OpenRouter({
  apiKey: OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': HTTP_REFERER,
    'X-Title': X_TITLE
  }
});

// helper: find the 'bot-warning' text channel in a guild and send a short message
async function notifyBotWarning(guild, content) {
  try {
    if (!guild) return;
    const channel = guild.channels.cache.find(ch => ch.name === 'bot-warning' && (ch.type === ChannelType.GuildText || ch.isTextBased?.()));
    if (!channel) {
      console.warn(`bot-warning channel not found in guild ${guild.id} (${guild.name})`);
      return;
    }
    await channel.send(content);
  } catch (err) {
    console.error('Failed to send bot-warning message:', err);
  }
}

// helper: fetch the latest audit log entry for the guild, optionally filtered by type
async function fetchLatestAuditEntry(guild, type) {
  try {
    const options = { limit: 1 };
    if (type) options.type = type;
    const logs = await guild.fetchAuditLogs(options);
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
  const entry = await fetchLatestAuditEntry(role.guild, AuditLogEvent.RoleCreate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(role.guild, `:warning: Role created: **${role.name}** — by **${executor}** | ${reason}`);
});

client.on('roleDelete', async (role) => {
  const entry = await fetchLatestAuditEntry(role.guild, AuditLogEvent.RoleDelete);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(role.guild, `:warning: Role deleted: **${role.name}** — by **${executor}** | ${reason}`);
});

client.on('roleUpdate', async (oldRole, newRole) => {
  const entry = await fetchLatestAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newRole.guild, `:warning: Role updated: **${oldRole.name}** → **${newRole.name}** — by **${executor}** | ${reason}`);
});

// Channel events
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.ChannelCreate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Channel created: **${channel.name}** — by **${executor}** | ${reason}`);
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.ChannelDelete);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Channel deleted: **${channel.name}** — by **${executor}** | ${reason}`);
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const entry = await fetchLatestAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newChannel.guild, `:warning: Channel updated: **${oldChannel.name || oldChannel.id}** — by **${executor}** | ${reason}`);
});

// Webhook update
client.on('webhookUpdate', async (channel) => {
  if (!channel.guild) return;
  const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.WebhookUpdate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(channel.guild, `:warning: Webhooks updated in channel **${channel.name}** — by **${executor}** | ${reason}`);
});

// Bans and guild updates
client.on('guildBanAdd', async (guild, user) => {
  const entry = await fetchLatestAuditEntry(guild, AuditLogEvent.MemberBanAdd);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(guild, `:warning: Member banned: **${user.tag}** — by **${executor}** | ${reason}`);
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
  const entry = await fetchLatestAuditEntry(newGuild, AuditLogEvent.GuildUpdate);
  const executor = entry?.executor?.tag || 'Unknown';
  const reason = entry?.reason || 'No reason';
  await notifyBotWarning(newGuild, `:warning: Guild updated — by **${executor}** | ${reason}`);
});

// Chatbot handler with retry logic
async function handleChatbot(message) {
  const maxRetries = 3; // Maximum number of retries
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const completion = await openRouter.chat.send({
        model: 'deepseek/deepseek-r1:free', // Updated: Use a supported model
        messages: [{ role: 'user', content: message.content }],
        stream: false
      });

      const reply = completion.choices[0].message.content;
      await message.reply(reply);
      return; // Exit the function if successful
    } catch (err) {
      console.error(`Chatbot error (attempt ${attempt + 1}):`, err);

      if (err.statusCode === 429) {
        // Rate limit error
        if (attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.warn(`Rate limited. Retrying in ${waitTime / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          await message.reply('⚠️ The chatbot is currently rate-limited. Please try again later.');
          return;
        }
      } else {
        // Other errors
        await message.reply('⚠️ Sorry, I encountered an error processing your request.');
        return;
      }
    }

    attempt++;
  }
}

// Simple command handler preserved
client.on('messageCreate', async (message) => {
  if (message.content === '!ping') {
    message.reply('🏓 Pong!');
    return;
  }

  // help command: explain bot capabilities (terminal-like theme)
  if (message.content === '!help') {
    const help = [
      '```',
      '┌──────────────────────────────────────────────────────────────────────────│',
      '│  Discord Audit Notifier                                                  │', 
      '├──────────────────────────────────────────────────────────────────────────│',
      '│  Commands:                                                               │',                       
      '│    !ping   — test the bot                                                │',
      '│    !help   — show this message                                           │',
      '│ ─────────────────────────────────────────────────────────────────────────│',
      '│  What I do:                                                              │',
      '│    Notify the channel named "bot-warning" when important                 │',
      '│    audit-log events occur (roles, channels, webhooks, bans,              │',
      '│    guild updates).                                                       │',
      '│                                                                          │',
      '│  Notes:                                                                  │',
      '│    • Bot needs "View Audit Log" and "Send Messages" permissions.         │',
      '│    • Ensure a text channel named "bot-warning" exists.                   │',
      '│    • Chatbot uses OpenRouter (GPT-4) for responses.                     │',
      '│    • Set HTTP_REFERER and X_TITLE in .env for ranking (optional).       │',
      '└──────────────────────────────────────────────────────────────────────────',
      '```'
    ].join('\n');

    message.reply(help);
    return;
  }

  // Ignore bot messages and non-command messages in the chatbot channel
  if (message.author.bot || message.channel.name !== CHATBOT_CHANNEL_NAME) return;

  // Handle chatbot interaction
  await handleChatbot(message);
});

// Login (single call)
client.login(TOKEN).then(() => {
  console.log('Bot logged in!');
}).catch(err => {
  console.error('Login failed:', err);
});
