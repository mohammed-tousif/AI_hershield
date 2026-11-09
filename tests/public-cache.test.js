'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Fake Firestore that counts reads (this file runs in its own process) ──
const store = new Map(); // collection -> Map(id -> data)
const calls = { get: 0, count: 0 };
let holdReads = null;    // a promise that delays full collection reads while set
const col = name => store.get(name) || store.set(name, new Map()).get(name);
const snapOf = name => {
    const rows = [...col(name)];
    return { empty: !rows.length, size: rows.length, docs: rows.map(([id, d]) => ({ id, ref: { name, id }, data: () => ({ ...d }) })) };
};
let autoId = 0;
const fakeDb = {
    batch: () => {
        const ops = [];
        return {
            set: (ref, data) => ops.push(() => col(ref.name).set(ref.id, data)),
            delete: ref => ops.push(() => col(ref.name).delete(ref.id)),
            commit: async () => ops.forEach(op => op()),
        };
    },
    collection: name => ({
        get: async () => { calls.get++; if (holdReads) await holdReads; return snapOf(name); },
        limit: () => ({ get: async () => { calls.get++; return snapOf(name); } }),
        doc: (id = `auto${++autoId}`) => ({ name, id, set: async data => { col(name).set(id, data); } }),
        count: () => ({ get: async () => { calls.count++; return { data: () => ({ count: col(name).size }) }; } }),
        where: (field, _op, value) => ({ count: () => ({ get: async () => {
            calls.count++;
            return { data: () => ({ count: [...col(name).values()].filter(d => d[field] === value).length }) };
        } }) }),
    }),
};
require.cache[require.resolve('../config/firestoreAdmin')] = { id: 'fa', filename: 'fa', loaded: true, exports: { getFirestoreAdmin: () => fakeDb } };
const repo = require('../services/firestoreRepository');
const SAFETY = repo.COL.SAFETY_LOCATIONS;
const place = (location, risk_level = 2) => ({ latitude: 15.3, longitude: 75.1, risk_level, location, category: 'test', last_updated: '2026-11-09' });

test('Safety locations are read from Firestore once and served from memory after that', async () => {
    col(SAFETY).set('a', place('Old Hubli'));
    const before = calls.get;
    const first = await repo.safetyLocationsList();
    const second = await repo.safetyLocationsList();
    assert.equal(calls.get - before, 1, 'second call within the TTL needs no read');
    assert.deepEqual(second, first);
    second[0].location = 'mutated by a caller';
    assert.equal((await repo.safetyLocationsList())[0].location, 'Old Hubli', 'callers get copies, never the cached rows');
});

test('Concurrent first requests share a single Firestore read', async () => {
    await repo.safetyLocationsDeleteAll(); // also empties the cache
    col(SAFETY).set('b', place('Vidyanagar'));
    const before = calls.get;
    const [x, y, z] = await Promise.all([repo.safetyLocationsList(), repo.safetyLocationsList(), repo.safetyLocationsList()]);
    assert.equal(calls.get - before, 1);
    assert.equal(x.length, 1); assert.deepEqual(x, y); assert.deepEqual(y, z);
});

test('Every write path drops the cache, so the next read shows the change', async () => {
    await repo.safetyLocationsList(); // warm
    await repo.safetyLocationsAdd(place('Added by a user'));
    assert.ok((await repo.safetyLocationsList()).some(r => r.location === 'Added by a user'), 'add');

    await repo.safetyLocationsBulkImport([place('Imported by admin', 3)]);
    assert.ok((await repo.safetyLocationsList()).some(r => r.location === 'Imported by admin'), 'bulk import');

    await repo.safetyLocationsDeleteAll();
    assert.equal((await repo.safetyLocationsList()).length, 0, 'delete all');
});

test('A write during an in-flight read never lets the older rows be cached', async () => {
    await repo.safetyLocationsDeleteAll();
    col(SAFETY).set('c', place('Before the write'));
    let release;
    holdReads = new Promise(resolve => { release = resolve; });
    const slowRead = repo.safetyLocationsList();          // starts reading, then waits
    await repo.safetyLocationsAdd(place('Written meanwhile'));
    holdReads = null; release();
    await slowRead;
    const rows = await repo.safetyLocationsList();
    assert.ok(rows.some(r => r.location === 'Written meanwhile'), 'the read after the write is fresh');
});

test('A cached non-empty list skips the "is the collection empty?" seed check', async () => {
    col(SAFETY).set('d', place('Seed check'));
    await repo.safetyLocationsList();
    const before = calls.get;
    assert.deepEqual(await repo.safetyLocationsSeedFromCsvIfEmpty(), { seeded: false, count: 0 });
    assert.equal(calls.get, before);
});

test('Dashboard stats: one round of counts per minute, then stale-while-revalidate', async () => {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
        const usersCol = col(repo.COL.USERS);
        usersCol.set('u1', {});
        const first = await repo.getDashboardStats();
        const counted = calls.count;
        assert.equal(first.communityMembers, 1);

        usersCol.set('u2', {});
        assert.equal((await repo.getDashboardStats()).communityMembers, 1, 'fresh window: cached, no counts');
        assert.equal(calls.count, counted);

        now += 2 * 60 * 1000; // past the fresh window, inside the stale window
        assert.equal((await repo.getDashboardStats()).communityMembers, 1, 'stale value is returned immediately');
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(calls.count > counted, 'and a background refresh ran');
        assert.equal((await repo.getDashboardStats()).communityMembers, 2, 'the refreshed value is used next');

        now += 11 * 60 * 1000; // too old to serve: the caller waits for fresh counts
        usersCol.set('u3', {});
        assert.equal((await repo.getDashboardStats()).communityMembers, 3);
    } finally {
        Date.now = realNow;
    }
});
