#!/usr/bin/env node
'use strict';

const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');
const path = require('path');

const AUTH_PATH = '/data/.openclaw/agents/main/agent/auth-profiles.json';
const CONTAINER_TAG = 'your-name'; // ← замени на своё имя
const WORKSPACE = '/data/.openclaw/workspace';
const MEMORY_FILE = path.join(WORKSPACE, 'MEMORY.md');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

let apiKey;
try {
  const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  apiKey = auth.profiles['supermemory:default']?.apiKey;
  if (!apiKey) throw new Error('No supermemory:default profile found');
} catch (err) {
  console.error('❌ Auth error:', err.message);
  process.exit(1);
}

const client = new Supermemory({ apiKey });

async function sync() {
  let synced = 0;

  if (fs.existsSync(MEMORY_FILE)) {
    const content = fs.readFileSync(MEMORY_FILE, 'utf-8').trim();
    if (content) {
      console.log('📝 Syncing MEMORY.md...');
      await client.add({
        content, containerTag: CONTAINER_TAG,
        customId: 'memory-md-main',
        metadata: { type: 'long_term_memory', file: 'MEMORY.md' }
      });
      console.log('✅ MEMORY.md');
      synced++;
    }
  }

  if (fs.existsSync(MEMORY_DIR)) {
    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort().reverse().slice(0, 14);

    for (const file of files) {
      const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf-8').trim();
      if (content) {
        const date = file.replace('.md', '');
        console.log(`📅 Syncing ${file}...`);
        await client.add({
          content, containerTag: CONTAINER_TAG,
          customId: `daily-${date}`,
          metadata: { type: 'daily_memory', date, file }
        });
        console.log(`✅ ${file}`);
        synced++;
      }
    }
  }

  console.log(`\n✨ Synced ${synced} files`);
}

sync().catch(err => { console.error('❌', err.message); process.exit(1); });
