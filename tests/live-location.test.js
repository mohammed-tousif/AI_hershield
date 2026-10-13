'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Fake Firestore for the repository cache tests (this file runs in its own process) ──
const docs = new Map();
const calls = { get: 0, query: 0, update: [] };
function snap(id) { return { exists: docs.has(id), id, data: () => structuredClone(docs.get(id)) }; }
const fakeDb = {
    runTransaction() { throw new Error('live location writes must not use a transaction'); },
    collection: () => ({
        doc: id => ({
            get: async () => { calls.get++; return snap(id); },
            set: async (data, options) => { docs.set(id, options?.merge ? { ...docs.get(id), ...data } : data); },
            update: async data => { if (!docs.has(id)) throw new Error('NOT_FOUND'); calls.update.push(data); docs.set(id, { ...docs.get(id), lastLocation: data.lastLocation }); },
        }),
        where: (field, _op, value) => ({ limit: () => ({ get: async () => {
            calls.query++;
            const hits = [...docs.keys()].filter(id => docs.get(id)[field] === value);
            return { empty: !hits.length, docs: hits.map(snap) };
        } }) }),
    }),
};
require.cache[require.resolve('../config/firestoreAdmin')] = { id: 'fa', filename: 'fa', loaded: true, exports: { getFirestoreAdmin: () => fakeDb } };
const repo = require('../services/firestoreRepository');
const hub = require('../services/liveLocationHub');
require('../live-location-sender.js');
const Sender = globalThis.HSLocationSender;

const CODE_A = 'A'.repeat(64), CODE_B = 'B'.repeat(64);
const session = (code) => ({ userId: 'uid1', trackingCode: code, name: 'S', email: '', pinHash: '$2a$x', ownerUid: 'uid1',
    shareExpiresAt: new Date(Date.now() + 3600000).toISOString(), isTrackingActive: true, createdAt: new Date() });

test('An old SOS share link never resolves to a newer session that reuses the same id', async () => {
    await repo.liveSessionCreate(session(CODE_A), 'uid1');
    assert.equal((await repo.liveSessionFindByCode(CODE_A)).trackingCode, CODE_A);
    await repo.liveSessionCreate(session(CODE_B), 'uid1'); // SOS restarted: same doc id, new code
    assert.equal(await repo.liveSessionFindByCode(CODE_A), null);
    assert.equal((await repo.liveSessionFindByCode(CODE_B)).trackingCode, CODE_B);
});

test('Live-session reads are cached, stops invalidate, and a fix is one write with no read or transaction', async () => {
    await repo.liveSessionCreate(session(CODE_A), 'uid2');
    const before = calls.get;
    await repo.liveSessionGetByUserId('uid2');
    await repo.liveSessionGetByUserId('uid2');
    assert.equal(calls.get - before, 1, 'second read within the TTL comes from cache');

    const reads = calls.get;
    await repo.liveSessionPushLocation('uid2', 15, 75, 8, { appendToLog: false });
    assert.equal(calls.get, reads, 'pushing a fix does not read the document');
    assert.deepEqual(Object.keys(calls.update.at(-1)), ['lastLocation']);
    await repo.liveSessionPushLocation('uid2', 15.1, 75, 8, { appendToLog: true });
    assert.deepEqual(Object.keys(calls.update.at(-1)).sort(), ['lastLocation', 'locationLogs']);
    assert.equal((await repo.liveSessionGetByUserId('uid2')).lastLocation.lat, 15.1, 'cache follows the write');

    await repo.liveSessionStop('uid2');
    assert.equal((await repo.liveSessionGetByUserId('uid2')).isTrackingActive, false, 'stop is visible immediately');
});

test('Hub delivers every fix but persists on a throttle, samples history, and is scoped to the share code', () => {
    const t0 = 1_000_000;
    const p = (lat, i) => ({ lat, lng: 75, accuracy: 5, timestamp: new Date(t0 + i).toISOString() });
    assert.deepEqual(hub.noteLocation('s', CODE_A, p(15, 0), t0), { persist: true, appendToLog: true });
    hub.markPersisted('s', p(15, 0), { appendedToLog: true }, t0);
    assert.equal(hub.noteLocation('s', CODE_A, p(15.001, 2000), t0 + 2000).persist, false, 'moving: not every 2s');
    assert.deepEqual(hub.noteLocation('s', CODE_A, p(15.002, 5000), t0 + 5000), { persist: true, appendToLog: false });
    hub.markPersisted('s', p(15.002, 5000), { appendedToLog: false }, t0 + 5000);
    assert.equal(hub.noteLocation('s', CODE_A, p(15.002, 20000), t0 + 20000).persist, false, 'still: waits for the stationary interval');
    assert.deepEqual(hub.noteLocation('s', CODE_A, p(15.002, 35000), t0 + 35000), { persist: true, appendToLog: true });
    assert.equal(hub.snapshot('s', CODE_A).point.lat, 15.002);
    assert.equal(hub.snapshot('s', CODE_B), null, 'a different share code never sees this point');
    hub.forget('s'); assert.equal(hub.snapshot('s', CODE_A), null);
});

// ── Sender engine (live-location-sender.js) with fake clock, GPS and network ──
function harness({ respond } = {}) {
    let t = 1_700_000_000_000, tick = null, watch = null;
    const geo = { current: null, cleared: [], requests: 0 };
    const sent = [], states = [], statuses = [];
    const pending = [];
    const doc = { visibilityState: 'visible', listeners: {}, addEventListener(n, f) { this.listeners[n] = f; }, removeEventListener(n) { delete this.listeners[n]; } };
    let ended = null;
    const sender = new Sender({
        sessionId: 'sess',
        onStatus: s => statuses.push(s),
        onEnded: m => { ended = m; },
        env: {
            now: () => t,
            setInterval: fn => { tick = fn; return 1; },
            clearInterval: () => { tick = null; },
            document: doc,
            wakeLock: { request: async () => ({ addEventListener() {}, release: async () => {} }) },
            isSecureContext: true,
            geolocation: {
                watchPosition: success => { watch = success; return 7; },
                clearWatch: id => geo.cleared.push(id),
                getCurrentPosition: (success, error) => { geo.requests++; if (geo.current) success(geo.current); else error({ code: 3, message: 'timeout' }); },
            },
            fetch: (url, init) => {
                const body = JSON.parse(init.body);
                if (url.endsWith('/sender-state')) { states.push({ ...body, keepalive: init.keepalive }); return Promise.resolve({ ok: true, json: async () => ({ success: true }) }); }
                sent.push(body);
                if (respond) return Promise.resolve(respond(body));
                return new Promise(resolve => pending.push(() => resolve({ ok: true, status: 200, json: async () => ({ success: true }) })));
            },
        },
    });
    const fix = (lat, ageMs = 0, accuracy = 8) => ({ coords: { latitude: lat, longitude: 75, accuracy }, timestamp: t - ageMs });
    return {
        sender, sent, states, statuses, geo, doc, pending,
        get ended() { return ended; },
        advance(ms) { t += ms; }, now: () => t,
        move(lat, ageMs, accuracy) { watch(fix(lat, ageMs, accuracy)); },
        tick() { tick?.(); },
        settle: () => new Promise(r => setImmediate(r)),
        fix,
    };
}

test('Slow uploads never run in parallel, and the newest fix is sent next instead of being dropped', async () => {
    const h = harness();
    h.sender.start();
    h.move(15.000);
    assert.equal(h.sent.length, 1);
    h.advance(500); h.move(15.001);
    h.advance(500); h.move(15.002); // both arrive while the first upload is still in flight
    assert.equal(h.sent.length, 1, 'no parallel upload');
    h.pending.shift()(); await h.settle();
    h.advance(1000); h.tick(); // 2s cadence reached
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1].lat, 15.002, 'the newest fix, not the one that arrived in between');
    h.sender.stop();
});

test('While standing still a heartbeat re-checks GPS and reports the fix\'s true age', async () => {
    const h = harness({ respond: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) });
    h.sender.start();
    h.move(15); await h.settle();
    assert.equal(h.sent.length, 1);
    h.geo.current = h.fix(15); // standing still: GPS keeps handing back this same fix
    h.advance(9000); h.tick(); await h.settle();
    assert.equal(h.sent.length, 1, 'no upload before the heartbeat interval');
    h.advance(1000); h.tick(); await h.settle();
    assert.equal(h.sent.length, 2, 'a heartbeat upload happened without any movement');
    assert.equal(h.sent[1].fixAgeMs, 10000, 'the unchanged fix is reported with its true age, not as fresh');
    h.advance(10000);
    h.geo.current = h.fix(15); // a genuinely new reading at the same spot
    h.tick(); await h.settle();
    assert.equal(h.sent.at(-1).fixAgeMs, 0, 'a new fix resets the age even without movement');
    h.sender.stop();
});

test('A cached fix keeps its real age, and network/IP-level accuracy is never shared', async () => {
    const h = harness({ respond: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) });
    h.sender.start();
    h.move(15, 0, 5000);
    assert.equal(h.sent.length, 0, '±5 km is not a real GPS fix');
    assert.ok(h.statuses.some(s => s.type === 'low-accuracy'));
    h.move(15, 25000, 10);
    assert.ok(h.sent[0].fixAgeMs >= 25000);
    h.sender.stop();
});

test('Failed uploads retry with the newest fix; an ended share stops sharing for good', async () => {
    let mode = 'fail';
    const h = harness({ respond: () => mode === 'fail' ? Promise.reject(new Error('offline'))
        : { ok: false, status: 409, json: async () => ({ success: false, ended: true, message: 'This tracking session has ended.' }) } });
    h.sender.start();
    h.move(15); await h.settle();
    assert.ok(h.statuses.some(s => s.type === 'retrying'));
    h.advance(1000); h.move(15.001);
    assert.equal(h.sent.length, 1, 'backs off before retrying');
    h.advance(2000); h.tick(); await h.settle();
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent.at(-1).lat, 15.001, 'retry carries the newest fix');
    mode = 'ended';
    h.advance(1000); h.move(15.002);
    h.advance(3000); h.tick(); await h.settle();
    assert.equal(h.ended, 'This tracking session has ended.');
    assert.deepEqual(h.geo.cleared, [7], 'GPS watch released');
    const count = h.sent.length;
    h.advance(20000); h.tick(); await h.settle();
    assert.equal(h.sent.length, count, 'nothing is sent after the share ended');
});

test('Guardians are told when the sender\'s page goes to the background and comes back', async () => {
    const h = harness({ respond: () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) });
    h.sender.start();
    h.move(15); await h.settle();
    h.doc.visibilityState = 'hidden'; h.doc.listeners.visibilitychange();
    assert.deepEqual(h.states.at(-1), { userId: 'sess', state: 'background', keepalive: true });
    h.doc.visibilityState = 'visible'; h.doc.listeners.visibilitychange();
    assert.equal(h.states.at(-1).state, 'active');
    h.sender.stop();
});
