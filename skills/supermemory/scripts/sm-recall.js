#!/usr/bin/env node
'use strict';

// CommonJS: try .default first (standard for ESM default export), fallback to direct
const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');

const AUTH_PATH = '/data/.openclaw/agents/main/agent/auth-profiles.json';
const CONTAINER_TAG = 'your-name'; // ← замени на своё имя

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
const cmd = process.argv[2];
const query = process.argv.slice(3).join(' ');

async function recall(q) {
  const profile = await client.profile({
    containerTag: CONTAINER_TAG,
    q: q,
    threshold: 0.4
  });

  console.log('=== PROFILE ===');
  if (profile.profile?.static?.length > 0) {
    console.log('📌 Static:');
    profile.profile.static.forEach(f => console.log(`  - ${f}`));
  }
  if (profile.profile?.dynamic?.length > 0) {
    console.log('🔄 Dynamic:');
    profile.profile.dynamic.forEach(f => console.log(`  - ${f}`));
  }

  const search = await client.search.memories({
    q: q,
    containerTag: CONTAINER_TAG,
    searchMode: 'hybrid',
    limit: 10,
    threshold: 0.4,
    rerank: true
  });

  console.log(`\n=== SEARCH (${search.timing}ms, ${search.total} total) ===`);
  if (search.results?.length > 0) {
    search.results.forEach((r, i) => {
      const text = r.memory || r.chunk || '(no content)';
      console.log(`${i + 1}. [${(r.similarity * 100).toFixed(0)}%] ${text}`);
      if (r.metadata?.session_date) console.log(`   📅 ${r.metadata.session_date}`);
    });
  } else {
    console.log('Nothing found.');
  }
}

async function main() {
  if (cmd === 'recall' && query) {
    await recall(query);
  } else if (cmd === 'profile') {
    const profile = await client.profile({ containerTag: CONTAINER_TAG });
    console.log(JSON.stringify(profile, null, 2));
  } else {
    console.log('Usage:');
    console.log('  node sm-recall.js recall "query"');
    console.log('  node sm-recall.js profile');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
