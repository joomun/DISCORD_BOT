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

// Login
client.login(TOKEN).then(() => {
  console.log('Bot logged in!');
}).catch(err => {
  console.error('Login failed:', err);
});
