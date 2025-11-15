require('dotenv').config(); // load .env
const { Client, GatewayIntentBits, AuditLogEvent, ChannelType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { exec } = require('child_process'); // Import exec to run mermaid.cli commands
const fs = require('fs'); // Import fs for file handling
const path = require('path'); // Import path for file paths

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

// Helper: Send logs to the 'bot-logs' channel with embed
async function sendLogToChannel(guild, logContent) {
  try {
    if (!guild) return;
    const logChannel = guild.channels.cache.find(ch => ch.name === 'bot-logs' && (ch.type === ChannelType.GuildText || ch.isTextBased?.()));
    if (!logChannel) {
      console.warn(`bot-logs channel not found in guild ${guild.id} (${guild.name})`);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xffcc00) // Yellow color
      .setTitle('API Log')
      .setDescription('Details of the API interaction')
      .addFields(
        { name: 'Log Content', value: `\`\`\`json\n${JSON.stringify(logContent, null, 2)}\n\`\`\`` }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to send log to bot-logs channel:', err);
  }
}

// Chatbot handler with embed responses
async function handleChatbot(message) {
  const maxRetries = 3; // Maximum number of retries
  let attempt = 0;

  // Extract model shortcut from the message
  const shortcut = message.content.split(":")[0].trim().toLowerCase();
  const model = MODEL_SHORTCUTS[shortcut];

  if (!model) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000) // Red color
      .setTitle('Invalid Model Shortcut')
      .setDescription('Use one of the following shortcuts:')
      .addFields(
        { name: 'a:', value: 'openai/gpt-oss-20b:free', inline: true },
        { name: 'b:', value: 'moonshotai/kimi-k2:free', inline: true },
        { name: 'c:', value: 'deepseek/deepseek-r1-0528-qwen3-8b:free', inline: true },
        { name: 'd:', value: 'google/gemma-3-4b-it:free', inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
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
          // Extract rate limit details
          const rateLimitMessage = errorData.error?.error?.message || "Rate limit exceeded.";
          const rateLimitRemaining = errorData.error?.error?.metadata?.headers?.["X-RateLimit-Remaining"] || "0";
          const rateLimitReset = errorData.error?.error?.metadata?.headers?.["X-RateLimit-Reset"];
          const resetTime = rateLimitReset ? new Date(parseInt(rateLimitReset)).toLocaleString() : "unknown";

          const embed = new EmbedBuilder()
            .setColor(0xffcc00) // Yellow color
            .setTitle('Rate Limit Exceeded')
            .setDescription(rateLimitMessage)
            .addFields(
              { name: 'Remaining Requests', value: rateLimitRemaining, inline: true },
              { name: 'Reset Time', value: resetTime, inline: true }
            )
            .setTimestamp();

          await message.reply({ embeds: [embed] });
          return;
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

      const embed = new EmbedBuilder()
        .setColor(0x00ff00) // Green color
        .setTitle('Chatbot Response')
        .setDescription(reply)
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return; // Exit the function if successful
    } catch (err) {
      console.error(`Unexpected error (attempt ${attempt + 1}):`, err);

      // Log unexpected error to the bot-logs channel
      await sendLogToChannel(message.guild, { error: err.message });

      const embed = new EmbedBuilder()
        .setColor(0xff0000) // Red color
        .setTitle('Unexpected Error')
        .setDescription('Sorry, I encountered an unexpected error.')
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    attempt++;
  }
}

// Helper: Fetch and display rate limit information
async function fetchRateLimitInfo(message) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to fetch rate limit info:', errorData);

      const embed = new EmbedBuilder()
        .setColor(0xff0000) // Red color
        .setTitle('Rate Limit Info Error')
        .setDescription('Failed to fetch rate limit information.')
        .addFields(
          { name: 'Status', value: `${response.status} ${response.statusText}`, inline: true },
          { name: 'Error', value: errorData.message || 'Unknown error', inline: true }
        )
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    const keyInfo = await response.json();
    const rateLimit = keyInfo.rate_limit || {};
    const remaining = rateLimit.remaining || 'Unknown';
    const limit = rateLimit.limit || 'Unknown';
    const reset = rateLimit.reset ? new Date(rateLimit.reset * 1000).toLocaleString() : 'Unknown';

    const embed = new EmbedBuilder()
      .setColor(0x00ccff) // Blue color
      .setTitle('Rate Limit Information')
      .addFields(
        { name: 'Remaining Requests', value: `${remaining}`, inline: true },
        { name: 'Request Limit', value: `${limit}`, inline: true },
        { name: 'Reset Time', value: `${reset}`, inline: true }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error('Unexpected error while fetching rate limit info:', err);

    const embed = new EmbedBuilder()
      .setColor(0xff0000) // Red color
      .setTitle('Unexpected Error')
      .setDescription('An unexpected error occurred while fetching rate limit information.')
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

// Helper: Generate Mermaid chart and send it as an image
async function generateMermaidChart(message, mermaidCode) {
  try {
    // Define file paths
    const inputFilePath = path.join(__dirname, 'temp', `chart-${Date.now()}.mmd`);
    const outputFilePath = path.join(__dirname, 'temp', `chart-${Date.now()}.png`);

    // Ensure the temp directory exists
    if (!fs.existsSync(path.join(__dirname, 'temp'))) {
      fs.mkdirSync(path.join(__dirname, 'temp'));
    }

    // Write the Mermaid code to a temporary file
    fs.writeFileSync(inputFilePath, mermaidCode);

    // Generate the chart using mermaid.cli
    exec(`mmdc -i ${inputFilePath} -o ${outputFilePath}`, async (err) => {
      if (err) {
        console.error('Failed to generate Mermaid chart:', err);

        const embed = new EmbedBuilder()
          .setColor(0xff0000) // Red color
          .setTitle('Mermaid Chart Error')
          .setDescription('Failed to generate the Mermaid chart. Please ensure your code is valid.')
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }

      // Send the generated chart as an image attachment
      const attachment = new AttachmentBuilder(outputFilePath);
      await message.reply({ files: [attachment] });

      // Clean up temporary files
      fs.unlinkSync(inputFilePath);
      fs.unlinkSync(outputFilePath);
    });
  } catch (err) {
    console.error('Unexpected error while generating Mermaid chart:', err);

    const embed = new EmbedBuilder()
      .setColor(0xff0000) // Red color
      .setTitle('Unexpected Error')
      .setDescription('An unexpected error occurred while generating the Mermaid chart.')
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
}

// Simple command handler preserved
client.on('messageCreate', async (message) => {
  if (message.content === '!ping') {
    message.reply('🏓 Pong!');
    return;
  }

  if (message.content === '!help') {
    const embed = new EmbedBuilder()
      .setColor(0x00ccff) // Blue color
      .setTitle('Discord Audit Notifier - Help')
      .setDescription('Here are the available commands and features:')
      .addFields(
        { name: 'Commands', value: '`!ping` - Test the bot\n`!help` - Show this help message\n`!rate-limit` - Show OpenRouter API rate limit information\n`!mermaid` - Generate a Mermaid chart from code' },
        { name: 'Chatbot Shortcuts', value: [
            '`a: <message>` - openai/gpt-oss-20b:free',
            '`b: <message>` - moonshotai/kimi-k2:free',
            '`c: <message>` - deepseek/deepseek-r1-0528-qwen3-8b:free',
            '`d: <message>` - google/gemma-3-4b-it:free'
          ].join('\n') },
        { name: 'Features', value: [
            '• Notifies the "bot-warning" channel for important audit-log events (roles, channels, webhooks, bans, guild updates).',
            '• Logs API interactions in the "bot-logs" channel.',
            '• Supports multiple chatbot models via shortcuts.',
            '• Generates Mermaid charts from `.md` code.'
          ].join('\n') },
        { name: 'Notes', value: [
            '• Bot needs "View Audit Log" and "Send Messages" permissions.',
            '• Ensure a text channel named "bot-warning" exists.',
            '• Ensure a text channel named "bot-logs" exists for logging.',
            '• Set `HTTP_REFERER` and `X_TITLE` in `.env` for ranking (optional).',
            '• Install `mermaid.cli` globally for Mermaid chart generation.'
          ].join('\n') }
      )
      .setFooter({ text: 'Discord Audit Notifier', iconURL: client.user.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }

  if (message.content.startsWith('!mermaid')) {
    const mermaidCode = message.content.slice(8).trim(); // Extract the Mermaid code
    if (!mermaidCode) {
      const embed = new EmbedBuilder()
        .setColor(0xffcc00) // Yellow color
        .setTitle('Mermaid Chart Error')
        .setDescription('Please provide valid Mermaid code after the `!mermaid` command.')
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    await generateMermaidChart(message, mermaidCode);
    return;
  }

  if (message.content === '!rate-limit') {
    await fetchRateLimitInfo(message);
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
