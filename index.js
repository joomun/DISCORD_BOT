require('dotenv').config();
const { Client, GatewayIntentBits, AuditLogEvent } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildAuditLogs
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;

client.login(TOKEN).then(() => console.log('Bot logged in!')).catch(console.error);

client.on('messageCreate', (message) => {
  if (message.content === '!ping') message.reply('🏓 Pong!');
});

client.on('guildAuditLogEntryCreate', async (auditLog) => {
  try {
    const channel = auditLog.guild.channels.cache.find(c => c.type === 0);
    if (!channel) return;

    const actionName = Object.keys(AuditLogEvent).find(key => AuditLogEvent[key] === auditLog.action) || auditLog.action;

    await channel.send(`🔔 New audit log entry:\nAction: ${actionName}\nPerformed by: ${auditLog.executor.tag}`);
  } catch (err) {
    console.error('Error handling audit log:', err);
  }
});
