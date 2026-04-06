#!/usr/bin/env node
/**
 * Quick API smoke checks. Start the server first, or pass SMOKE_BASE.
 *   set SMOKE_BASE=http://127.0.0.1:3003 && node scripts/smoke-api.js
 */
'use strict';

const base = (process.env.SMOKE_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function req(method, path, body) {
    const url = `${base}${path}`;
    const opt = { method, headers: { Accept: 'application/json' } };
    if (body != null) {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(body);
    }
    const res = await fetch(url, opt);
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { _parseError: true, snippet: text.slice(0, 120) };
    }
    return { ok: res.ok, status: res.status, json, text };
}

function fail(msg) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
}

async function main() {
    console.log('Smoke base:', base);

    const h = await req('GET', '/api/health');
    if (h.status !== 200) fail(`/api/health expected 200, got ${h.status}`);
    else console.log('OK  GET /api/health', h.json?.status || '');

    const posts = await req('GET', '/api/community/posts?limit=5');
    if (posts.status !== 200) fail(`/api/community/posts expected 200, got ${posts.status}`);
    else if (!posts.json || posts.json.success !== true) fail('community posts: success!==true');
    else console.log('OK  GET /api/community/posts', Array.isArray(posts.json.posts) ? `${posts.json.posts.length} posts` : '');

    const heat = await req('GET', '/api/safety/heatmap?north=20&south=10&east=80&west=70');
    if (heat.status !== 200) fail(`/api/safety/heatmap expected 200, got ${heat.status}`);
    else console.log('OK  GET /api/safety/heatmap');

    const route = await req('POST', '/api/safety/route', {
        routePoints: [
            { lat: 12.97, lng: 77.59 },
            { lat: 12.98, lng: 77.6 },
        ],
        timeOfDay: 14,
    });
    if (route.status !== 200) fail(`/api/safety/route expected 200, got ${route.status}`);
    else console.log('OK  POST /api/safety/route', route.json?.safetyScore != null ? `score=${route.json.safetyScore}` : '');

    const reportBad = await req('POST', '/api/safety/report', { type: '', description: '' });
    if (reportBad.status !== 400) {
        console.warn('WARN POST /api/safety/report (empty) expected 400, got', reportBad.status);
    } else console.log('OK  POST /api/safety/report validation (400 on empty)');

    const reportOk = await req('POST', '/api/safety/report', {
        type: 'other',
        severity: 'low',
        description: 'Smoke test incident',
        location: { address: 'Test location', coordinates: null },
    });
    if (reportOk.status === 503 || reportOk.json?.message?.includes('Firestore')) {
        console.log('SKIP POST /api/safety/report persist (Firestore not configured)');
    } else if (reportOk.status === 200 && reportOk.json?.success) {
        console.log('OK  POST /api/safety/report', reportOk.json.reportId || '');
    } else {
        fail(`/api/safety/report unexpected ${reportOk.status} ${JSON.stringify(reportOk.json)}`);
    }

    const cp = await req('POST', '/api/community/posts', {
        content: `Smoke test ${Date.now()}`,
        userName: 'smoke',
        category: 'general',
    });
    if (cp.status === 503 || cp.json?.message?.includes('Firestore')) {
        console.log('SKIP POST /api/community/posts (Firestore not configured)');
    } else if (cp.status === 201 && cp.json?.success) {
        console.log('OK  POST /api/community/posts');
    } else {
        fail(`/api/community/posts unexpected ${cp.status} ${JSON.stringify(cp.json)}`);
    }

    if (process.exitCode) console.error('\nSmoke finished with failures.');
    else console.log('\nSmoke finished OK.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
