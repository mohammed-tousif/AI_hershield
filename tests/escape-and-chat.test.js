'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── config.js in a minimal browser-like sandbox ──
function loadConfig() {
    const window = { fetch: async () => ({}), addEventListener() {} };
    const context = {
        window, location: { hostname: 'localhost', origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
        sessionStorage: { getItem: () => null, setItem() {} }, document: {}, URL, Request: class {}, Headers: class {},
        AbortController, DOMException, setTimeout, clearTimeout, Response: class {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config.js'), 'utf8'), context);
    return window;
}

test('Stored user text shows as typed and can never break out of an HTML attribute', () => {
    const { hsEscapeStoredText: esc } = loadConfig();
    // services/sanitize.js stores "&" as "&amp;": readers must see "&", not "&amp;"
    assert.equal(esc('Large Gathering &amp; Protests'), 'Large Gathering &amp; Protests');
    assert.equal(esc('a &lt; b'), 'a &lt; b');
    // the payloads that used to escape quote-blind helpers
    for (const attack of ['x" onmouseover="alert(1)//', "https://x.com/a.png');alert(1);//", '&quot; onerror=&quot;alert(1)']) {
        const out = esc(attack);
        assert.ok(!/["'<>]/.test(out), `no raw quote or bracket survives: ${out}`);
    }
    assert.equal(esc(null), '');
});

// ── LexaShield model fallback with a fake Groq SDK ──
const calls = [];
let unavailable = new Set(['llama-3.3-70b-versatile']);
let nextError = null;
class FakeGroq {
    constructor() {
        this.chat = { completions: { create: async (req) => {
            calls.push(req.model);
            if (nextError) { const e = nextError; nextError = null; throw e; }
            if (unavailable.has(req.model)) throw Object.assign(new Error('404 model'), { status: 404, error: { error: { code: 'model_not_found' } } });
            return { model: req.model, choices: [{ message: { content: 'answer' } }], usage: { total_tokens: 10 } };
        } } };
    }
}
require.cache[require.resolve('groq-sdk')] = { id: 'groq', filename: 'groq', loaded: true, exports: FakeGroq };
process.env.GROQ_API_KEY = 'test-key';
process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
const legal = require('../services/legalChatService');

test('LexaShield falls back from a retired Groq model and remembers the working one', async () => {
    const first = await legal.chat('What law covers stalking?');
    assert.equal(first.content, 'answer');
    assert.deepEqual(calls, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);

    calls.length = 0;
    await legal.chat('And online threats?');
    assert.deepEqual(calls, ['openai/gpt-oss-120b'], 'the next request goes straight to the working model');
});

test('LexaShield does not hide real failures (bad key, rate limit) behind the fallback', async () => {
    nextError = Object.assign(new Error('401 invalid api key'), { status: 401, error: { error: { code: 'invalid_api_key' } } });
    await assert.rejects(legal.chat('hello'), /invalid api key/);
});
