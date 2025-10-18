import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import cron from 'node-cron';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DAILY_PUSH_CRON = '59 23 * * *'; // 每天 23:59 推播

if (!TOKEN || !CHANNEL_ID) {
  console.error('❌ 請先設定 .env 內的 DISCORD_BOT_TOKEN 與 DISCORD_CHANNEL_ID');
  process.exit(1);
}

// 獲取當天所有訊息
async function getTodayMessages() {
  const today = getTodayTW();
  console.log(`📅 查詢 ${today} 的動漫更新（最近100筆）...`);
  
  try {
    // 直接拉取最近 100 筆訊息
    const messages = await fetchMessages(null, 100);
    console.log(`📥 獲取到 ${messages.length} 則最近訊息`);
    
    // 輸出原始訊息資料用於除錯
    console.log('=== 原始訊息資料 (前30筆) ===');
    messages.slice(0, 30).forEach((msg, index) => {
      console.log(`\n訊息 ${index + 1}:`);
      console.log(`  ID: ${msg.id}`);
      console.log(`  作者: ${msg.author.username} (ID: ${msg.author.id}, bot: ${msg.author.bot})`);
      console.log(`  時間: ${msg.timestamp}`);
      console.log(`  內容: "${msg.content}"`);
      console.log(`  Embeds: ${msg.embeds?.length || 0} 個`);
      console.log(`  Attachments: ${msg.attachments?.length || 0} 個`);
      if (msg.embeds?.length > 0) {
        console.log(`  Embed URLs: ${msg.embeds.map(e => e.url).filter(Boolean)}`);
      }
      console.log(`  isToday(): ${isToday(msg.timestamp)}`);
    });
    console.log('=== 原始訊息資料結束 ===\n');
    
    const todayMessages = [];
    
    for (const msg of messages) {
      // 檢查是否為當天訊息
      const isTodayMsg = isToday(msg.timestamp);
      if (!isTodayMsg) {
        continue;
      }
      
      // 過濾 bot 訊息和指令，但保留動漫更新 bot
      if (msg.author.bot && msg.author.username !== 'Anime1.me #更新通知') {
        console.log(`⚠️ 略過: [${msg.author.username} (bot)] ${msg.content || '(embed)'}`);
        continue;
      }
      
      // 過濾指令訊息
      if (msg.content?.startsWith('/')) {
        console.log(`⚠️ 略過: [${msg.author.username}] ${msg.content}`);
        continue;
      }
      
      console.log(`✅ 找到動漫更新: [${msg.author.username}] ${msg.content || '(embed)'}`.substring(0, 100));
      
      let contentToSend = '';
      
      // 判斷訊息內容
      if ((msg.embeds?.length > 0) || (msg.attachments?.length > 0)) {
        // 取連結
        const links = [];
        for (const embed of msg.embeds || []) {
          if (embed.url) links.push(embed.url);
          if (embed.description) {
            const found = embed.description.match(urlRegex);
            if (found) links.push(...found);
          }
        }
        for (const att of msg.attachments || []) {
          if (att.url) links.push(att.url);
        }
        contentToSend = links.join('\n') || msg.content || '';
      } else {
        // 取文字內容
        contentToSend = msg.content || '';
      }
      
      todayMessages.push({
        author: msg.author.username,
        content: contentToSend || '<無文字>',
        timestamp: msg.timestamp,
        id: msg.id
      });
    }
    
    console.log(`📊 查詢完成，共找到 ${todayMessages.length} 則今日動漫更新`);
    return todayMessages;
    
  } catch (err) {
    console.error('❌ 查詢當日訊息失敗：', err.message);
    return [];
  }
}

// Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const urlRegex = /(https?:\/\/[^\s]+)/g;

// 統一使用台灣時區
function getTodayTW() {
  const now = new Date();
  const taiwanTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return taiwanTime.toISOString().split('T')[0];
}

// Discord 時間戳解析函數 - 處理微秒格式
// 將 Discord 的分數秒數正規化為 3 位毫秒格式
function parseDiscordTimestamp(ts) {
  if (!ts) return null;
  let s = ts;

  // 如果有分數秒，保留/填充/截取為 3 位數
  if (/\.\d/.test(s)) {
    s = s.replace(/(\.\d+)([+-]\d{2}:\d{2}|Z)$/, (m, frac, tz) => {
      // frac 包含前導點，例如 ".685000" -> slice(1) => "685000"
      const ms = (frac.slice(1) + '000').slice(0, 3); // 填充或截取為 3 位
      return '.' + ms + tz;
    });
  } else {
    // 沒有分數秒，在時區前插入 .000
    s = s.replace(/([0-9]{2}:[0-9]{2}:[0-9]{2})([+-]\d{2}:\d{2}|Z)$/, (m, time, tz) => {
      return time + '.000' + tz;
    });
  }

  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

const isToday = (timestamp) => {
  const parsed = parseDiscordTimestamp(timestamp);
  if (!parsed) return false;

  // 直接使用 toLocaleDateString 取得台灣日期字串
  const taiwanDateStr = parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }); // en-CA 格式是 YYYY-MM-DD
  const todayTW = getTodayTW();
  return taiwanDateStr === todayTW;
};

// 抓取訊息
async function fetchMessages(afterId = null, limit = 50) {
  // 使用與 testAPI.js 相同的 URL 構建方式
  let url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
  if (afterId) {
    url += `&after=${afterId}`;
  }

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bot ${TOKEN}`, 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API 錯誤：${res.status} ${res.statusText} - ${text}`);
    }

    return res.json();
  } catch (err) {
    console.error('❌ Discord fetchMessages 錯誤：', err);
    throw err; // 繼續拋出錯誤
  }
}

// 測試批次推播
async function testDailyBatch() {
  console.log('🧪 === 測試模式：模擬每日批次推播 ===');
  
  // 直接查詢過濾後的訊息
  const todayMessages = await getTodayMessages();
  
  if (todayMessages.length === 0) {
    console.log('📭 測試結果：今日無新訊息');
    return;
  }

  // 按時間排序（舊到新）
  todayMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // 合併所有訊息
  const combinedMessage = `🗓️ 今日動漫更新 (${todayMessages.length} 則)\n\n` +
    todayMessages.map((msg, index) => 
      `${index + 1}. [${msg.author}] ${msg.content}`
    ).join('\n\n');

  console.log('🧪 === 測試結果：將要推播的內容 ===');
  console.log(combinedMessage);
  console.log('🧪 === 測試完成 ===');
  console.log(`📊 統計：共 ${todayMessages.length} 則訊息，合併後長度 ${combinedMessage.length} 字元`);
}

// 批次推播當日訊息
async function sendDailyBatch() {
  console.log('⏰ 開始執行每日批次推播...');
  
  // 直接查詢當天所有訊息
  const todayMessages = await getTodayMessages();
  
  if (todayMessages.length === 0) {
    console.log('📭 今日無新訊息，略過推播');
    return;
  }

  // 按時間排序（舊到新）
  todayMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // 合併所有訊息
  const combinedMessage = `🗓️ 今日動漫更新 (${todayMessages.length} 則)\n\n` +
    todayMessages.map((msg, index) => 
      `${index + 1}. [${msg.author}] ${msg.content}`
    ).join('\n\n');

  console.log(`📤 準備推播當日合併訊息 (共 ${todayMessages.length} 則)`);

  try {
    const response = await fetch('http://localhost:3000/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: combinedMessage
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    console.log(`✅ 批次推播成功：${JSON.stringify(result)}`);
    
  } catch (error) {
    console.error(`❌ 批次推播失敗:`, error.message);
  }
}

// Discord 事件
client.once('ready', async () => {
  console.log(`✅ 已登入 Discord Bot：${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  if (message.content === '/health') {
    await message.reply('alive ✅');
    console.log(`🩺 /health 回覆給 ${message.author.tag}`);
  }

  if (message.content === '/test-daily') {
    await message.reply('🧪 測試模式：開始查詢今日訊息...');
    console.log(`🧪 測試模式觸發 - 由 ${message.author.tag} 執行`);
    await testDailyBatch();
  }
});

// 每日批次推播排程
cron.schedule(DAILY_PUSH_CRON, async () => {
  console.log('⏰ 觸發每日批次推播');
  await sendDailyBatch();
}, {
  timezone: "Asia/Taipei"
});

// 登入 Discord
client.login(TOKEN);
