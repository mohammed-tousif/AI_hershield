'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const { createEmailVerificationService } = require('../services/emailVerification');

// Serialized transactional store: writes commit together, failed transactions roll back.
const records = new Map();
let queue = Promise.resolve();
const copy = value => value === undefined ? undefined : structuredClone(value);
const db = {
    collection: name => ({ doc: id => ({ key: name + '/' + id, get: async function () { return { data: () => copy(records.get(this.key)) }; } }) }),
    runTransaction: callback => {
        const run = queue.then(async () => {
            const pending = new Map();
            const result = await callback({ get: ref => ref.get(), set: (ref, value) => pending.set(ref.key, copy(value)) });
            for (const [key, value] of pending) records.set(key, value);
            return result;
        });
        queue = run.catch(() => {}); return run;
    }
};
let time, accounts, deliveries, configured, deliveryFails;
const auth = {
    getUser: async uid => copy(accounts[uid]),
    verifyIdToken: async (token, checkRevoked) => {
        assert.equal(checkRevoked, true);
        if (!accounts[token]) throw Error('Invalid token');
        return { uid: token, email: token + '@example.test' };
    }
};
const mailer = {
    isConfigured: () => configured,
    sendMail: async email => {
        if (deliveryFails) throw Error('Provider secret must not escape');
        deliveries.push(email); return { success: true };
    }
};
function mock(name, exports) { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('../config/firestoreAdmin', { getFirestoreAdmin: () => db });
mock('firebase-admin', { apps: [{}], auth: () => auth });
mock('../services/emailService', mailer);
mock('../services/emailVerification', { createEmailVerificationService: dependencies => createEmailVerificationService({ ...dependencies, now: () => time }) });
let server, base;
before(async () => {
    const app = express(); app.use(express.json());
    app.use('/api', require('../middleware/apiAccess').apiAccess);
    app.use('/api/email-verification', require('../routes/emailVerification'));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/api/email-verification/';
});
after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
beforeEach(() => {
    records.clear(); time = Date.now(); configured = true; deliveryFails = false; deliveries = [];
    accounts = Object.fromEntries(['alice', 'bob'].map(uid => [uid, { uid, email: uid + '@example.test', emailVerified: false }]));
});
async function request(action, body, user = 'alice') {
    const response = await fetch(base + action, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + user } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
}
const code = () => deliveries.at(-1).html.match(/>(\d{6})<\/p>/)[1];
const record = () => records.get('emailVerification/alice');

test('OTP routes require authentication and never accept a target UID or email from the browser', async () => {
    for (const action of ['status', 'send', 'verify']) assert.equal((await request(action, action === 'status' ? undefined : {}, null)).status, 401);
    await request('send', { uid: 'bob', email: 'bob@example.test', verified: true });
    assert.equal(deliveries[0].to, 'alice@example.test');
    assert.equal((await request('status')).data.verified, false);
    assert.equal((await request('verify', { code: code() }, 'bob')).status, 400);
});
test('OTP is hashed at rest, never returned, consumed atomically and survives a fresh service instance', async () => {
    const sent = await request('send', {});
    assert.equal(sent.status, 200); assert.equal(sent.data.expiresIn, 300);
    const otp = code();
    assert.ok(record().codeHash.startsWith('$2')); assert.notEqual(record().codeHash, otp); assert.equal(record().code, undefined);
    assert.ok(!JSON.stringify(sent.data).includes(otp)); assert.equal(sent.headers.get('cache-control'), 'no-store');
    assert.equal((await request('verify', { code: otp })).data.verified, true);
    assert.equal(record().codeHash, null); assert.equal(record().state, 'verified');
    const firstVerifiedAt = record().verifiedAt;
    time += 1000;
    assert.equal((await request('verify', { code: otp })).data.verified, true); // Idempotent status, no new consumption.
    assert.equal(record().verifiedAt, firstVerifiedAt);
    assert.equal((await request('status')).data.verified, true);
});
test('Expired codes and malformed values never verify an account', async () => {
    await request('send', {}); const otp = code();
    for (const invalid of [123456, '12345', '1234567', { code: otp }]) assert.equal((await request('verify', { code: invalid })).status, 400);
    time += 300000;
    assert.equal((await request('verify', { code: otp })).status, 400);
    assert.equal((await request('status')).data.verified, false);
});
test('Incorrect attempts commit, lock after five, and repeated resends cannot reset the hourly guess budget', async () => {
    await request('send', {});
    for (let round = 0; round < 2; round++) {
        const wrong = code() === '000000' ? '000001' : '000000';
        for (let i = 0; i < 5; i++) assert.equal((await request('verify', { code: wrong })).status, 400);
        assert.equal((await request('verify', { code: code() })).status, 429);
        time += 61000; await request('send', {});
    }
    assert.equal(record().checks, 10);
    assert.equal((await request('verify', { code: code() })).status, 429);
});
test('Cooldown and hourly delivery budgets persist across requests and account changes', async () => {
    await request('send', {});
    const limited = await request('send', {});
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
    for (let i = 1; i < 5; i++) { time += 61000; assert.equal((await request('send', {})).status, 200); }
    time += 61000; assert.equal((await request('send', {})).status, 429);
    // A second UID with the same email cannot bypass its delivery budget.
    const service = createEmailVerificationService({ db, auth, mailer, now: () => time });
    accounts.bob.email = accounts.alice.email;
    assert.equal((await service.send({ uid: 'bob', email: accounts.bob.email })).status, 429);
    time += 3600000; assert.equal((await request('send', {})).status, 200);
});
test('Resend invalidates the old challenge and concurrent requests reserve only one delivery', async () => {
    const responses = await Promise.all([request('send', {}), request('send', {})]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 429]);
    assert.equal(deliveries.length, 1);
    const oldId = record().challengeId, oldHash = record().codeHash;
    time += 61000; await request('send', {});
    assert.notEqual(record().challengeId, oldId); assert.notEqual(record().codeHash, oldHash);
    assert.equal((await request('verify', { code: code() })).data.verified, true);
});
test('Concurrent correct verification is idempotent; no race loses failed-attempt increments', async () => {
    await request('send', {});
    const wrong = code() === '000000' ? '000001' : '000000';
    await Promise.all([request('verify', { code: wrong }), request('verify', { code: wrong })]);
    assert.equal(record().attempts, 2);
    const results = await Promise.all([request('verify', { code: code() }), request('verify', { code: code() })]);
    assert.ok(results.every(result => result.data.verified)); assert.equal(record().attempts, 3);
});
test('Delivery failure leaves no usable code or verified badge and does not leak provider errors', async () => {
    deliveryFails = true;
    const result = await request('send', {});
    assert.equal(result.status, 503); assert.equal(result.data.verified, undefined);
    assert.ok(!JSON.stringify(result.data).includes('Provider secret'));
    assert.equal(record().codeHash, null); assert.equal(record().state, 'failed');
    assert.equal((await request('status')).data.verified, false);
    assert.equal((await request('verify', { code: '123456' })).status, 400);
    assert.equal((await request('send', {})).status, 429);
});
test('Missing mail configuration fails clearly without reserving or sending a code', async () => {
    configured = false;
    assert.equal((await request('send', {})).status, 503);
    assert.equal(records.size, 0); assert.equal(deliveries.length, 0);
});
test('Verification is bound to the current account email and stale tokens are rejected', async () => {
    await request('send', {}); await request('verify', { code: code() });
    accounts.alice.email = 'new@example.test';
    assert.equal((await request('status')).status, 409);
    const service = createEmailVerificationService({ db, auth, mailer, now: () => time });
    assert.equal((await service.status({ uid: 'alice', email: 'new@example.test' })).body.verified, false);
});
test('Trusted provider verification is preserved; disabled or email-less accounts cannot send', async () => {
    accounts.alice.emailVerified = true;
    assert.equal((await request('status')).data.verified, true);
    assert.equal((await request('send', {})).data.verified, true);
    assert.equal(deliveries.length, 0);
    accounts.alice.disabled = true; assert.equal((await request('send', {})).status, 401);
    accounts.bob.email = null; assert.equal((await request('send', {}, 'bob')).status, 400);
});
