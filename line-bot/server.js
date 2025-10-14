import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { Client, middleware } from '@line/bot-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const { CHANNEL_SECRET, CHANNEL_ACCESS_TOKEN, PORT = 3000 } = process.env;

const config = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN
};

const client = new Client(config);
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_FILE = path.resolve(__dirname, 'users.json');
let knownUsers = new Set();

const loadUsers = () => {
  if (!fs.existsSync(USERS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    knownUsers = new Set(data);
    console.log(`📂 已載入 ${knownUsers.size} 位使用者`);
  } catch (err) {
    console.error('❌ 無法讀取 users.json：', err.message);
  }
};

const saveUsers = () => {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify([...knownUsers], null, 2));
    console.log(`💾 已儲存 ${knownUsers.size} 位使用者`);
  } catch (err) {
    console.error('❌ 儲存 users.json 失敗：', err.message);
  }
};

loadUsers();

app.post('/webhook', middleware(config), (req, res) => {
  const events = req.body.events || [];

  if (!events.length) {
    console.log('⚠️ 收到空的 events');
    return res.sendStatus(200);
  }

  events.forEach(async e => {
    const time = new Date(e.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const userId = e.source?.userId || '未知';
    const type = e.type;
    const message = e.message?.text || '(非文字訊息)';

    console.log(`📩 收到 LINE 事件：
                👤 使用者：${userId}
                💬 類型：${type}
                📝 內容：${message}
                🕒 時間：${time}`);

    // 🩺 health check
    if (message === '/health' && userId && type === 'message') {
      await client.replyMessage(e.replyToken, {
        type: 'text',
        text: 'alive ✅'
      });
      return;
    }

    // 新使用者加入
    if (userId && (type === 'follow' || type === 'message') && !knownUsers.has(userId)) {
      knownUsers.add(userId);
      saveUsers();
      console.log(`✅ 新使用者已加入：${userId}`);
    }
  });

  res.sendStatus(200);
});


app.post('/notify', express.json(), async (req, res) => {
  const body = req.body || {};
  const message = body.message;
  if (!message) return res.status(400).json({ error: '缺少 message' });

  console.log(`📨 從 Discord 收到訊息: ${message}`);

  const pushList = [...knownUsers];
  if (!pushList.length) {
    console.log('⚠️ 尚無已知使用者，略過推送');
    return res.json({ success: false, reason: 'no users' });
  }

  const results = await Promise.all(
    pushList.map(userId =>
      client.pushMessage(userId, { type: 'text', text: message })
        .then(() => ({ userId, success: true }))
        .catch(err => {
          console.error(`❌ 推送給 ${userId} 失敗：`, err.message);
          return { userId, success: false, error: err.message };
        })
    )
  );

  const successCount = results.filter(r => r.success).length;
  console.log(`✅ 推播完成：${successCount}/${pushList.length} 成功`);
  res.json({ success: true, sentTo: successCount });
});


app.listen(PORT, () => {
  console.log(`🚀 LINE bot 已啟動於 http://localhost:${PORT}`);
});
