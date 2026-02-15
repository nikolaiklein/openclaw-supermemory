#!/usr/bin/env node
'use strict';

const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================================================
// CONFIGURATION - with environment variable support and validation
// ============================================================================

/**
 * Get CONTAINER_TAG from environment variable with validation
 * Falls back to 'default' only if env var is not set
 * @returns {string} validated container tag
 */
function getContainerTag() {
  const tag = process.env.SM_CONTAINER_TAG;
  
  // If not set, use fallback but warn
  if (!tag) {
    console.warn('[WARN] SM_CONTAINER_TAG not set, using fallback "default". Set env var to avoid data mixing.');
    return 'default';
  }
  
  // Validate: reject placeholder values
  const invalidTags = ['your-name', 'your_name', 'yourname', 'test', 'example', ''];
  const normalizedTag = tag.trim().toLowerCase();
  
  if (invalidTags.includes(normalizedTag)) {
    console.error(`[ERROR] SM_CONTAINER_TAG="${tag}" is a placeholder value. Please set a unique identifier.`);
    process.exit(1);
  }
  
  // Validate: minimum length
  if (tag.trim().length < 2) {
    console.error(`[ERROR] SM_CONTAINER_TAG must be at least 2 characters.`);
    process.exit(1);
  }
  
  return tag.trim();
}

const CONFIG = {
  AUTH_PATH: process.env.SM_AUTH_PATH || '/data/.openclaw/agents/main/agent/auth-profiles.json',
  SESSIONS_DIR: process.env.SM_SESSIONS_DIR || '/data/.openclaw/agents/main/sessions',
  SESSIONS_META: process.env.SM_SESSIONS_META || '/data/.openclaw/agents/main/sessions/sessions.json',
  STATE_FILE: process.env.SM_STATE_FILE || '/data/.openclaw/workspace/memory/sm-sync-state.json',
  CONTAINER_TAG: getContainerTag(),
  BATCH_SIZE: parseInt(process.env.SM_BATCH_SIZE, 10) || 20,
  CHECK_INTERVAL_MS: parseInt(process.env.SM_CHECK_INTERVAL_MS, 10) || 120000,
  MIN_NEW_MESSAGES: parseInt(process.env.SM_MIN_NEW_MESSAGES, 10) || 5,
  // API timeout and retry configuration
  API_TIMEOUT_MS: parseInt(process.env.SM_API_TIMEOUT_MS, 10) || 30000,
  API_RETRY_ATTEMPTS: parseInt(process.env.SM_API_RETRY_ATTEMPTS, 10) || 3,
  API_RETRY_BASE_DELAY_MS: parseInt(process.env.SM_API_RETRY_BASE_DELAY_MS, 10) || 1000,
};

// ============================================================================
// LOGGING with sensitive data scrubbing
// ============================================================================

/**
 * Patterns to scrub from log messages to prevent API key leakage
 */
const SENSITIVE_PATTERNS = [
  { regex: /sm_[a-zA-Z0-9_]+/g, replacement: '[REDACTED_API_KEY]' },
  { regex: /api[_-]?key[:\s=]+["']?[^\s"']+["']?/gi, replacement: 'api_key=[REDACTED]' },
  { regex: /authorization[:\s=]+["']?[^\s"']+["']?/gi, replacement: 'authorization=[REDACTED]' },
  { regex: /bearer\s+[a-zA-Z0-9_\.\-]+/gi, replacement: 'Bearer [REDACTED]' },
];

/**
 * Scrub sensitive data from message
 * @param {string} msg - message to scrub
 * @returns {string} scrubbed message
 */
function scrubSensitiveData(msg) {
  if (typeof msg !== 'string') return msg;
  let scrubbed = msg;
  for (const pattern of SENSITIVE_PATTERNS) {
    scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
  }
  return scrubbed;
}

function log(msg) { 
  console.log(`[${new Date().toISOString()}] ${scrubSensitiveData(msg)}`); 
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

function loadState() {
  try {
    if (fs.existsSync(CONFIG.STATE_FILE))
      return JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
  } catch (err) { 
    log(`⚠️ State load failed: ${scrubSensitiveData(err.message)}`); 
  }
  return { sessions: {}, totalSynced: 0, lastSyncTime: 0 };
}

function saveState(state) {
  try {
    const dir = path.dirname(CONFIG.STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) { 
    log(`❌ State save failed: ${scrubSensitiveData(err.message)}`); 
  }
}

// ============================================================================
// API CALLS WITH TIMEOUT AND RETRY
// ============================================================================

/**
 * Sleep helper for exponential backoff
 * @param {number} ms - milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 * @param {number} attempt - current attempt (0-based)
 * @returns {number} delay in milliseconds
 */
function getRetryDelay(attempt) {
  // Exponential backoff: 1s, 2s, 4s + up to 1s random jitter
  const baseDelay = CONFIG.API_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(baseDelay + jitter, 30000); // Cap at 30s
}

/**
 * Execute API call with timeout and retry logic
 * @param {Function} apiCall - async function that makes the API call
 * @param {string} operationName - name of operation for logging
 * @returns {Promise<any>} API call result
 */
async function apiCallWithRetry(apiCall, operationName) {
  let lastError;
  
  for (let attempt = 0; attempt < CONFIG.API_RETRY_ATTEMPTS; attempt++) {
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);
      
      try {
        // Pass signal to API call if supported
        const result = await apiCall({ signal: controller.signal });
        return result;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      lastError = err;
      
      // Don't retry on client errors (4xx except 429 rate limit)
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
        throw err;
      }
      
      // Don't retry on abort if it was user-initiated
      if (err.name === 'AbortError') {
        throw err;
      }
      
      // Log retry attempt
      if (attempt < CONFIG.API_RETRY_ATTEMPTS - 1) {
        const delay = getRetryDelay(attempt);
        log(`⚠️ ${operationName} failed (attempt ${attempt + 1}/${CONFIG.API_RETRY_ATTEMPTS}): ${scrubSensitiveData(err.message)}. Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  throw lastError;
}

// ============================================================================
// SESSION HANDLING
// ============================================================================

function getSessionFiles() {
  try {
    const meta = JSON.parse(fs.readFileSync(CONFIG.SESSIONS_META, 'utf8'));
    return Object.entries(meta)
      .filter(([, v]) => v.sessionFile && fs.existsSync(v.sessionFile))
      .map(([key, v]) => ({ key, file: v.sessionFile, id: v.sessionId }));
  } catch (err) { 
    log(`⚠️ Sessions meta: ${scrubSensitiveData(err.message)}`); 
    return []; 
  }
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
    } catch (e) { 
      // Log parsing errors for debugging but continue
      if (e instanceof SyntaxError) {
        log(`⚠️ JSON parse error at line ${lineNum} in ${path.basename(sessionFile)}: ${e.message}`);
      }
    }
  }
  return { messages, totalLines: lineNum };
}

// ============================================================================
// SYNC LOGIC
// ============================================================================

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
        await apiCallWithRetry(
          async ({ signal }) => client.add({
            content, containerTag: CONFIG.CONTAINER_TAG, customId,
            metadata: {
              type: 'conversation', session_key: session.key,
              session_id: session.id, batch_id: String(batchIndex),
              session_date: sessionDate, message_count: String(batch.length)
            }
          }),
          `Batch #${batchIndex} upload`
        );
        
        ss.batchCount = batchIndex;
        state.totalSynced += batch.length;
        log(`✅ Batch #${batchIndex} (${batch.length} msgs)`);
      } catch (err) {
        log(`❌ API error: ${scrubSensitiveData(err.message)}`);
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

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log('🚀 SM Auto-Sync Daemon v3.0');
  log(`📦 Container tag: ${CONFIG.CONTAINER_TAG}`);
  
  let apiKey;
  try {
    const auth = JSON.parse(fs.readFileSync(CONFIG.AUTH_PATH, 'utf8'));
    apiKey = auth.profiles['supermemory:default']?.apiKey;
    if (!apiKey) throw new Error('No supermemory:default profile');
  } catch (err) { 
    log(`❌ ${scrubSensitiveData(err.message)}`); 
    process.exit(1); 
  }

  const client = new Supermemory({ apiKey });
  log('✅ Client ready');

  // Keep current state in closure to avoid race condition on shutdown
  let currentState = loadState();
  
  // Graceful shutdown handler - uses current state from closure
  const shutdown = () => { 
    log('🛑 Shutdown'); 
    saveState(currentState); // Use current state, don't reload from file
    process.exit(0); 
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (true) {
    try { 
      await syncOnce(client, currentState); 
    }
    catch (err) { 
      log(`❌ ${scrubSensitiveData(err.message)}`); 
    }
    await new Promise(r => setTimeout(r, CONFIG.CHECK_INTERVAL_MS));
  }
}

main();
