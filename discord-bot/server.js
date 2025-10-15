import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- 取得當前檔案目錄 ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const CHECK_INTERVAL_CRON = '*/30 * * * * *'; // 每30秒檢查一次
const STATE_FILE = path.resolve(__dirname, 'state.json'); // 放在同層

if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ 請先設定 .env 內的 DISCORD_BOT_TOKEN 與 DISCORD_CHANNEL_ID');
  process.exit(1);
}

// --- JSON 狀態管理 ---
function setLastMessageId(id) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastMessageId: id }, null, 2));
}

function getLastMessageId() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return data.lastMessageId || null;
  } catch {
    return null;
  }
}

// --- Discord Client ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const urlRegex = /(https?:\/\/[^\s]+)/g;
const isToday = (timestamp) => {
  const msgDate = new Date(timestamp);
  const now = new Date();
  return msgDate.getFullYear() === now.getFullYear() &&
    msgDate.getMonth() === now.getMonth() &&
    msgDate.getDate() === now.getDate();
};

// --- 抓取訊息 ---
async function fetchMessages(afterId = null) {
  const url = new URL(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`);
  url.searchParams.set('limit', '50');
  if (afterId) url.searchParams.set('after', afterId);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bot ${TOKEN}`, 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API 錯誤：${res.status} ${res.statusText} - ${text}`);
    }

    return res.json();
  } catch (err) {
    console.error('❌ Discord fetchMessages 錯誤：', err);
    throw err; // 繼續拋錯，讓上層知道
  }
}


// --- 處理訊息 ---
async function processMessages(isFirstRun = false) {
  try {
    const lastMessageId = getLastMessageId();
    const messages = await fetchMessages(lastMessageId);

    if (messages.length === 0) return;

    // 從舊到新
    messages.reverse().forEach(msg => {
      if (!isToday(msg.timestamp)) return;

      if (!isFirstRun) {
        let contentToSend = '';

        // 判斷訊息內容
        if ((msg.embeds && msg.embeds.length > 0) || (msg.attachments && msg.attachments.length > 0)) {
          // 取連結
          const links = [];
          (msg.embeds || []).forEach(embed => {
            if (embed.url) links.push(embed.url);
            if (embed.description) {
              const found = embed.description.match(urlRegex);
              if (found) links.push(...found);
            }
          });
          (msg.attachments || []).forEach(att => {
            if (att.url) links.push(att.url);
          });
          contentToSend = links.join('\n') || msg.content || '';
        } else {
          // 取文字
          contentToSend = msg.content || '';
        }

        console.log(`[${msg.author.username}] ${contentToSend || '<無文字>'}`);

        // 推送到 LINE Bot
        fetch('http://localhost:3000/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `[${msg.author.username}] ${contentToSend || '<無文字>'}` })
        })
          .then(res => {
            if (!res.ok) res.text().then(t => console.error('❌ LINE 回傳錯誤:', res.status, t));
          })
          .catch(err => console.error('❌ 無法傳送到 LINE bot:', err));
      }
    });

    // 更新 lastMessageId
    setLastMessageId(messages[messages.length - 1].id);

  } catch (err) {
    console.error('❌ 抓取訊息失敗：', err.message);
  }
}

// --- Discord 事件 ---
client.once('ready', async () => {
  console.log(`✅ 已登入 Discord Bot：${client.user.tag}`);
  await processMessages(true); // 第一次啟動不推送訊息
});

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  if (message.content === '/health') {
    await message.reply('alive ✅');
    console.log(`🩺 /health 回覆給 ${message.author.tag}`);
  }
});

// --- cron 排程 ---
cron.schedule(CHECK_INTERVAL_CRON, async () => {
  await processMessages(false);
});

// --- 登入 Discord ---
client.login(TOKEN);
