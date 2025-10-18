const dotenv = require('dotenv');
dotenv.config(); // 先讀根目錄的 .env

module.exports = {
  apps: [
    {
      name: 'line-bot',
      script: './line-bot/server.js',
      watch: true,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        CHANNEL_SECRET: process.env.CHANNEL_SECRET,
        CHANNEL_ACCESS_TOKEN: process.env.CHANNEL_ACCESS_TOKEN
      }
    },
    {
      name: 'discord-bot',
      script: './discord-bot/server.js',
      watch: true,
      env: {
        NODE_ENV: 'production'
        // 如果 discord-bot 也有 env，這裡也填
      }
    }
  ]
};
