'use strict';
/**
 * In-process "now" for live location sharing.
 *
 * Guardians get every accepted fix instantly over Socket.IO from this cache,
 * while Firestore only receives a throttled copy (so a restart or a late
 * viewer still sees a recent position). Without this split, a 2-second
 * update cadence would cost ~3 Firestore reads + 1 write per fix and exhaust
 * the free-tier daily quota within hours. Render runs a single instance, which
 * is also what the in-memory Socket.IO rooms already assume.
 *
 * Entries are tagged with the session's share code: SOS sessions reuse the
 * user's uid as the session id, so a stale entry from a previous session must
 * never be served under a new share code.
 */
const MOVING_PERSIST_MS = 5000;       // persist at most this often while moving
const STATIONARY_PERSIST_MS = 30000;  // ...and this often while standing still
const LOG_APPEND_MS = 30000;          // history sampling — bounds the Firestore doc size
const MOVED_METERS = 5;
const ENTRY_TTL_MS = 60 * 60 * 1000;

const entries = new Map(); // sessionId -> entry
let lastSweep = 0;

function distanceMeters(a, b) {
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sweep(now) {
    if (now - lastSweep < 60000) return;
    lastSweep = now;
    for (const [id, entry] of entries) if (now - entry.touchedAt > ENTRY_TTL_MS) entries.delete(id);
}

function entryFor(sessionId, code, now) {
    let entry = entries.get(sessionId);
    if (!entry || entry.code !== code) {
        entry = { code, point: null, senderSeenAt: null, senderState: null, senderStateAt: null,
            persistedPoint: null, persistedAt: 0, loggedAt: 0, touchedAt: now };
        entries.set(sessionId, entry);
    }
    entry.touchedAt = now;
    return entry;
}

/**
 * Records a fix and decides whether it should also be written to Firestore.
 * @returns {{ persist: boolean, appendToLog: boolean }}
 */
function noteLocation(sessionId, code, point, now = Date.now()) {
    sweep(now);
    const entry = entryFor(sessionId, code, now);
    entry.point = point;
    entry.senderSeenAt = now;
    entry.senderState = 'active';
    entry.senderStateAt = now;
    const since = now - entry.persistedAt;
    const moved = !entry.persistedPoint || distanceMeters(entry.persistedPoint, point) >= MOVED_METERS;
    const persist = since >= (moved ? MOVING_PERSIST_MS : STATIONARY_PERSIST_MS);
    return { persist, appendToLog: persist && now - entry.loggedAt >= LOG_APPEND_MS };
}

/** Call only after the Firestore write succeeded, so a failed write is retried. */
function markPersisted(sessionId, point, { appendedToLog }, now = Date.now()) {
    const entry = entries.get(sessionId);
    if (!entry) return;
    entry.persistedPoint = point;
    entry.persistedAt = now;
    if (appendedToLog) entry.loggedAt = now;
}

function noteSenderState(sessionId, code, state, now = Date.now()) {
    const entry = entryFor(sessionId, code, now);
    entry.senderState = state;
    entry.senderStateAt = now;
    entry.senderSeenAt = now;
    return entry;
}

/** Live view for a session, or null if nothing is known under this share code. */
function snapshot(sessionId, code) {
    const entry = entries.get(sessionId);
    if (!entry || entry.code !== code) return null;
    return {
        point: entry.point,
        senderSeenAt: entry.senderSeenAt ? new Date(entry.senderSeenAt).toISOString() : null,
        senderState: entry.senderState,
        senderStateAt: entry.senderStateAt ? new Date(entry.senderStateAt).toISOString() : null,
    };
}

function forget(sessionId) { entries.delete(sessionId); }

module.exports = { noteLocation, markPersisted, noteSenderState, snapshot, forget, distanceMeters,
    MOVING_PERSIST_MS, STATIONARY_PERSIST_MS, LOG_APPEND_MS };
