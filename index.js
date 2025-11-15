require('dotenv').config(); // load .env
const { Client, GatewayIntentBits, AuditLogEvent, ChannelType } = require('discord.js');
// const axios = require('axios'); // No longer needed

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

// Model shortcuts mapping
const MODEL_SHORTCUTS = {
  a: "openai/gpt-oss-20b:free",
  b: "moonshotai/kimi-k2:free",
  c: "deepseek/deepseek-r1-0528-qwen3-8b:free",
  d: "google/gemma-3-4b-it:free"
};

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

// Helper: Send logs to the 'bot-logs' channel
async function sendLogToChannel(guild, logContent) {
  try {
    if (!guild) return;
    const logChannel = guild.channels.cache.find(ch => ch.name === 'bot-logs' && (ch.type === ChannelType.GuildText || ch.isTextBased?.()));
    if (!logChannel) {
      console.warn(`bot-logs channel not found in guild ${guild.id} (${guild.name})`);
      return;
    }
    await logChannel.send(`\`\`\`json\n${JSON.stringify(logContent, null, 2)}\n\`\`\``);
  } catch (err) {
    console.error('Failed to send log to bot-logs channel:', err);
  }
}

// Chatbot handler with model shortcuts
async function handleChatbot(message) {
  const maxRetries = 3; // Maximum number of retries
  let attempt = 0;

  // Extract model shortcut from the message
  const shortcut = message.content.split(":")[0].trim().toLowerCase();
  const model = MODEL_SHORTCUTS[shortcut];

  if (!model) {
    await message.reply("⚠️ Invalid model shortcut. Use one of the following:\n- `a:` for openai/gpt-oss-20b:free\n- `b:` for moonshotai/kimi-k2:free\n- `c:` for deepseek/deepseek-r1-0528-qwen3-8b:free\n- `d:` for google/gemma-3-4b-it:free");
    return;
  }

  // Remove the shortcut from the message content
  const userMessage = message.content.slice(shortcut.length + 1).trim();

  while (attempt < maxRetries) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: userMessage }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`Chatbot error (attempt ${attempt + 1}):`, errorData);

        // Log error to the bot-logs channel
        await sendLogToChannel(message.guild, {
          error: errorData,
          status: response.status,
          statusText: response.statusText
        });

        if (response.status === 429) {
          // Rate limit error
          if (attempt < maxRetries - 1) {
            const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
            console.warn(`Rate limited. Retrying in ${waitTime / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            await message.reply("⚠️ The chatbot is currently rate-limited. Please try again later.");
            return;
          }
        } else if (response.status === 400) {
          await message.reply("⚠️ Bad request. Please check the chatbot configuration.");
          return;
        } else {
          await message.reply("⚠️ An error occurred while processing your request.");
          return;
        }
      }

      const data = await response.json();
      const reply = data.choices[0].message.content;

      // Log successful response to the bot-logs channel
      await sendLogToChannel(message.guild, {
        request: { content: userMessage, model: model },
        response: data
      });

      await message.reply(reply);
      return; // Exit the function if successful
    } catch (err) {
      console.error(`Unexpected error (attempt ${attempt + 1}):`, err);

      // Log unexpected error to the bot-logs channel
      await sendLogToChannel(message.guild, { error: err.message });

      await message.reply("⚠️ Sorry, I encountered an unexpected error.");
      return;
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
      '│  Chatbot Shortcuts:                                                      │',
      '│    a: <message> — openai/gpt-oss-20b:free                                │',
      '│    b: <message> — moonshotai/kimi-k2:free                                │',
      '│    c: <message> — deepseek/deepseek-r1-0528-qwen3-8b:free                │',
      '│    d: <message> — google/gemma-3-4b-it:free                              │',
      '│                                                                          │',
      '│  Notes:                                                                  │',
      '│    • Bot needs "View Audit Log" and "Send Messages" permissions.         │',
      '│    • Ensure a text channel named "bot-warning" exists.                   │',
      '│    • Ensure a text channel named "bot-logs" exists for logging.          │',
      '│    • Set HTTP_REFERER and X_TITLE in .env for ranking (optional).        │',
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
