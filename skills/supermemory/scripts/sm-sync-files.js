#!/usr/bin/env node
'use strict';

const _sm = require('supermemory');
const Supermemory = _sm.default || _sm;
const fs = require('fs');
const path = require('path');

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
  CONTAINER_TAG: getContainerTag(),
  WORKSPACE: process.env.SM_WORKSPACE || '/data/.openclaw/workspace',
  // API timeout and retry configuration
  API_TIMEOUT_MS: parseInt(process.env.SM_API_TIMEOUT_MS, 10) || 30000,
  API_RETRY_ATTEMPTS: parseInt(process.env.SM_API_RETRY_ATTEMPTS, 10) || 3,
  API_RETRY_BASE_DELAY_MS: parseInt(process.env.SM_API_RETRY_BASE_DELAY_MS, 10) || 1000,
};

const MEMORY_FILE = path.join(CONFIG.WORKSPACE, 'MEMORY.md');
const MEMORY_DIR = path.join(CONFIG.WORKSPACE, 'memory');

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
        console.error(`⚠️ ${operationName} failed (attempt ${attempt + 1}/${CONFIG.API_RETRY_ATTEMPTS}): ${scrubSensitiveData(err.message)}. Retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  throw lastError;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

let apiKey;
try {
  const auth = JSON.parse(fs.readFileSync(CONFIG.AUTH_PATH, 'utf8'));
  apiKey = auth.profiles['supermemory:default']?.apiKey;
  if (!apiKey) throw new Error('No supermemory:default profile found');
} catch (err) {
  console.error('❌ Auth error:', scrubSensitiveData(err.message));
  process.exit(1);
}

const client = new Supermemory({ apiKey });

// ============================================================================
// SYNC LOGIC
// ============================================================================

async function sync() {
  let synced = 0;

  if (fs.existsSync(MEMORY_FILE)) {
    const content = fs.readFileSync(MEMORY_FILE, 'utf-8').trim();
    if (content) {
      console.log('📝 Syncing MEMORY.md...');
      try {
        await apiCallWithRetry(
          async ({ signal }) => client.add({
            content, containerTag: CONFIG.CONTAINER_TAG,
            customId: 'memory-md-main',
            metadata: { type: 'long_term_memory', file: 'MEMORY.md' }
          }),
          'MEMORY.md upload'
        );
        console.log('✅ MEMORY.md');
        synced++;
      } catch (err) {
        console.error(`❌ Failed to sync MEMORY.md: ${scrubSensitiveData(err.message)}`);
      }
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
        try {
          await apiCallWithRetry(
            async ({ signal }) => client.add({
              content, containerTag: CONFIG.CONTAINER_TAG,
              customId: `daily-${date}`,
              metadata: { type: 'daily_memory', date, file }
            }),
            `${file} upload`
          );
          console.log(`✅ ${file}`);
          synced++;
        } catch (err) {
          console.error(`❌ Failed to sync ${file}: ${scrubSensitiveData(err.message)}`);
        }
      }
    }
  }

  console.log(`\n✨ Synced ${synced} files`);
}

sync().catch(err => { 
  console.error('❌', scrubSensitiveData(err.message)); 
  process.exit(1); 
});
