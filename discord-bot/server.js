import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';

// 從 .env 讀取設定
const TOKEN = process.env.DISCORD_BOT_TOKEN;

// 檢查是否有設定 token
if (!TOKEN) {
  console.error('❌ 錯誤：找不到 DISCORD_TOKEN，請確認 .env 檔案');
  process.exit(1);
}

// 建立 Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 登入後執行
client.once('ready', () => {
  console.log(`✅ 已登入 Discord Bot：${client.user.tag}`);
});

// 當有新訊息產生
client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  if (message.content === '/health') {
    await message.reply('alive ✅');
    console.log(`🩺 /health 回覆給 ${message.author.tag}`);
    return;
  }

  const msg = `[${message.guild?.name ?? 'DM'} / #${message.channel?.name ?? 'unknown'}] ${message.author.tag}: ${message.content}`;

  console.log(msg);

  try {
    const res = await fetch('http://localhost:3000/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });

    if (!res.ok) {
      // 失敗時印出返回內容方便除錯
      const text = await res.text().catch(() => '<no body>');
      console.error(`❌ notify 回傳錯誤: ${res.status} ${res.statusText} - ${text}`);
    }
  } catch (err) {
    console.error('❌ 無法傳送到 LINE bot:', err);
  }
});

// 啟動機器人
client.login(TOKEN);
