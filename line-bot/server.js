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
const SOURCES_FILE = path.resolve(__dirname, 'sources.json');
let knownSources = [];

function nowTW() {
  return new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
}

function loadSources() {
  if (!fs.existsSync(SOURCES_FILE)) {
    console.log(`[${nowTW()}] sources.json 不存在，將於首次寫入時建立`);
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    knownSources = Array.isArray(data) ? data : [];
    console.log(`[${nowTW()}] 已載入 ${knownSources.length} 個來源`);
  } catch (err) {
    console.error(`[${nowTW()}] 讀取 sources.json 失敗:`, err.message);
  }
}

function saveSources() {
  try {
    fs.writeFileSync(SOURCES_FILE, JSON.stringify(knownSources, null, 2));
    console.log(`[${nowTW()}] 已儲存 ${knownSources.length} 個來源`);
  } catch (err) {
    console.error(`[${nowTW()}] 儲存 sources.json 失敗:`, err.message);
  }
}

function isKnownSource(type, id) {
  return knownSources.some(s => s.type === type && s.id === id);
}

loadSources();

app.post('/webhook', middleware(config), (req, res) => {
  const events = req.body.events || [];

  if (!events.length) {
    console.log(`[${nowTW()}] ⚠️ 收到空的 events`);
    return res.sendStatus(200);
  }


  events.forEach(async e => {
    const time = new Date(e.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const sourceType = e.source?.type || 'unknown';
  let sourceId = '未知';
  if (sourceType === 'user') sourceId = e.source?.userId;
  else if (sourceType === 'group') sourceId = e.source?.groupId;
  else if (sourceType === 'room') sourceId = e.source?.roomId;
    const type = e.type;
    const message = e.message?.text || '(非文字訊息)';

    console.log(`[${time}] 📩 收到 LINE 事件：`);
    console.log(`[${time}] 👤 來源：${sourceType} (${sourceId})`);
    console.log(`[${time}] 💬 類型：${type}`);
    console.log(`[${time}] 📝 內容：${message}`);

    // 🩺 health check
    if (message === '/health' && sourceId && type === 'message') {
      await client.replyMessage(e.replyToken, {
        type: 'text',
        text: 'alive ✅'
      });
      return;
    }

    // 新來源加入
    if (sourceId && (type === 'follow' || type === 'join' || type === 'message') && !isKnownSource(sourceType, sourceId)) {
      knownSources.push({ type: sourceType, id: sourceId });
      // 移除重複來源（只保留唯一 type+id）
      knownSources = knownSources.filter((s, idx, arr) =>
        arr.findIndex(t => t.type === s.type && t.id === s.id) === idx
      );
      saveSources();
      console.log(`[${time}] ✅ 新來源已加入：${sourceType} (${sourceId})`);
    }

    // 封鎖/移除來源
    if ((type === 'unfollow' && sourceType === 'user') || (type === 'leave' && (sourceType === 'group' || sourceType === 'room'))) {
      const before = knownSources.length;
      knownSources = knownSources.filter(s => !(s.type === sourceType && s.id === sourceId));
      if (knownSources.length < before) {
        saveSources();
        console.log(`[${time}] 🚫 來源已移除：${sourceType} (${sourceId})`);
      }
    }
  });

  res.sendStatus(200);
});


app.post('/notify', express.json(), async (req, res) => {
  const body = req.body || {};
  const message = body.message;
  if (!message) return res.status(400).json({ error: '缺少 message' });

  console.log(`[${nowTW()}] 📨 從 Discord 收到訊息: ${message}`);

  // 發送訊息前，去除重複來源
  const pushList = knownSources.filter((s, idx, arr) =>
    arr.findIndex(t => t.type === s.type && t.id === s.id) === idx
  );
  if (!pushList.length) {
    console.log(`[${nowTW()}] ⚠️ 尚無已知來源，略過推送`);
    return res.json({ success: false, reason: 'no users' });
  }

  const results = await Promise.all(
    pushList.map(source =>
      client.pushMessage(source.id, { type: 'text', text: message })
        .then(() => ({ ...source, success: true }))
        .catch(err => {
          console.error(`[${nowTW()}] ❌ 推送給 ${source.type}(${source.id}) 失敗：`, err.message);
          return { ...source, success: false, error: err.message };
        })
    )
  );

  const successCount = results.filter(r => r.success).length;
  console.log(`[${nowTW()}] ✅ 推播完成：${successCount}/${pushList.length} 成功`);
  res.json({ success: true, sentTo: successCount });
});


app.listen(PORT, () => {
  console.log(`[${nowTW()}] 🚀 LINE bot 已啟動於 http://localhost:${PORT}`);
});
