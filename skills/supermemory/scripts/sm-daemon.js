#!/usr/bin/env node
'use strict';

const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
  AUTH_PATH: '/data/.openclaw/agents/main/agent/auth-profiles.json',
  SESSIONS_DIR: '/data/.openclaw/agents/main/sessions',
  SESSIONS_META: '/data/.openclaw/agents/main/sessions/sessions.json',
  STATE_FILE: '/data/.openclaw/workspace/memory/sm-sync-state.json',
  CONTAINER_TAG: 'nn02-andrew',
  BATCH_SIZE: 20,
  CHECK_INTERVAL_MS: 120000,
  MIN_NEW_MESSAGES: 5,
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE))
      return JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
  } catch (err) { log(`⚠️ State load failed: ${err.message}`); }
  return { sessions: {}, totalSynced: 0, lastSyncTime: 0 };
}

function saveState(state) {
  try {
    const dir = path.dirname(CONFIG.STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) { log(`❌ State save failed: ${err.message}`); }
}

function getSessionFiles() {
  try {
    const meta = JSON.parse(fs.readFileSync(CONFIG.SESSIONS_META, 'utf8'));
    return Object.entries(meta)
      .filter(([, v]) => v.sessionFile && fs.existsSync(v.sessionFile))
      .map(([key, v]) => ({ key, file: v.sessionFile, id: v.sessionId }));
  } catch (err) { log(`⚠️ Sessions meta: ${err.message}`); return []; }
}

async function readMessages(sessionFile, offsetLines) {
  const messages = [];
  const stream = fs.createReadStream(sessionFile);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= offsetLines || !line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record.type !== 'message' || !record.message) continue;
      const { role, content } = record.message;
      if (role !== 'user' && role !== 'assistant') continue;

      let text;
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content))
        text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      else text = JSON.stringify(content);

      if (!text.trim() || text === 'HEARTBEAT_OK' || text.startsWith('Read HEARTBEAT.md')) continue;

      messages.push({
        role, text: text.substring(0, 5000),
        timestamp: record.message.timestamp || record.timestamp, lineNum
      });
    } catch (e) { /* skip */ }
  }
  return { messages, totalLines: lineNum };
}

async function syncOnce(client, state) {
  const sessions = getSessionFiles();
  if (!sessions.length) { log('⚠️ No sessions'); return; }

  for (const session of sessions) {
    const ss = state.sessions[session.key] || { lastLine: 0, batchCount: 0 };
    const { messages, totalLines } = await readMessages(session.file, ss.lastLine);

    if (messages.length < CONFIG.MIN_NEW_MESSAGES) {
      log(`📊 ${session.key}: ${messages.length} new (need ${CONFIG.MIN_NEW_MESSAGES})`);
      continue;
    }

    const batchSize = CONFIG.BATCH_SIZE * 2;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      if (batch.length < 2) continue;

      const batchIndex = ss.batchCount + 1;
      const content = batch.map(m => {
        const ts = m.timestamp ? new Date(m.timestamp).toISOString() : 'unknown';
        return `[${ts}] [${m.role}]: ${m.text}`;
      }).join('\n\n');

      const firstTs = batch[0].timestamp;
      const sessionDate = firstTs
        ? new Date(firstTs).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const customId = `session-${session.id}-batch-${batchIndex}`;
      log(`🔄 Batch #${batchIndex} ${session.key} (${batch.length} msgs)...`);

      try {
        await client.add({
          content, containerTag: CONFIG.CONTAINER_TAG, customId,
          metadata: {
            type: 'conversation', session_key: session.key,
            session_id: session.id, batch_id: String(batchIndex),
            session_date: sessionDate, message_count: String(batch.length)
          }
        });
        ss.batchCount = batchIndex;
        state.totalSynced += batch.length;
        log(`✅ Batch #${batchIndex} (${batch.length} msgs)`);
      } catch (err) {
        log(`❌ API error: ${err.message}`);
        saveState(state);
        return;
      }
    }

    ss.lastLine = totalLines;
    state.sessions[session.key] = ss;
    state.lastSyncTime = Date.now();
    saveState(state);
  }
}

async function main() {
  log('🚀 SM Auto-Sync Daemon v2.0');
  let apiKey;
  try {
    const auth = JSON.parse(fs.readFileSync(CONFIG.AUTH_PATH, 'utf8'));
    apiKey = auth.profiles['supermemory:default']?.apiKey;
    if (!apiKey) throw new Error('No supermemory:default profile');
  } catch (err) { log(`❌ ${err.message}`); process.exit(1); }

  const client = new Supermemory({ apiKey });
  log('✅ Client ready');

  const shutdown = () => { log('🛑 Shutdown'); saveState(loadState()); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    try { await syncOnce(client, loadState()); }
    catch (err) { log(`❌ ${err.message}`); }
    await new Promise(r => setTimeout(r, CONFIG.CHECK_INTERVAL_MS));
  }
}

main();
