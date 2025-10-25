require('dotenv').config(); // load .env

const { Client, GatewayIntentBits, AuditLogEvent } = require('discord.js');

// Create client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildAuditLogs
  ]
});

// Read token from environment variable
const TOKEN = process.env.DISCORD_TOKEN;

// Login
client.login(TOKEN).then(() => {
  console.log('Bot logged in!');
}).catch(err => {
  console.error('Login failed:', err);
});

client.on('messageCreate', (message) => {
  if (message.content === '!ping') {
    message.reply('🏓 Pong!');
  }
});

// Add audit log monitoring
client.on('guildAuditLogEntryCreate', async (auditLog) => {
  try {
    // Get the first text channel to send notifications
    const channel = auditLog.guild.channels.cache.find(
      channel => channel.type === 0 // 0 is text channel
    );
    
    if (!channel) return;

    const executor = auditLog.executor;
    const action = auditLog.action;

    await channel.send(
      `🔔 New audit log entry:\nAction: ${action}\nPerformed by: ${executor.tag}`
    );
  } catch (error) {
    console.error('Error handling audit log:', error);
  }
});
