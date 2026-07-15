'use strict';

/**
 * Single persistence layer for Her Shield — Cloud Firestore (Admin SDK).
 * All former NeDB / Mongo / CSV / in-memory incident paths route here so admins can audit in Firebase Console.
 */
const { getFirestoreAdmin } = require('../config/firestoreAdmin');
const admin = require('firebase-admin');
const path = require('path');
const { createReadStream } = require('fs');
const csv = require('csv-parser');

const COL = {
    USERS: 'hershield_users',
    TRACKING_SESSIONS: 'hershield_tracking_sessions',
    INCIDENTS: 'hershield_incidents',
    COMMUNITY: 'hershield_community',
    LIVE_TRACKER: 'hershield_live_tracker_sessions',
    SAFETY_LOCATIONS: 'hershield_safety_locations',
    SOS_EVENTS: 'hershield_sos_events',
};

const MAX_INCIDENT_SCAN = 5000;
const MAX_LIVE_LOCATION_LOGS = 2000;

function firestoreOrThrow() {
    const db = getFirestoreAdmin();
    if (!db) {
        const err = new Error(
            'Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH to your service account .json file, or FIREBASE_SERVICE_ACCOUNT_JSON (see .env.example).'
        );
        err.code = 'FIRESTORE_NOT_CONFIGURED';
        err.statusCode = 503;
        throw err;
    }
    return db;
}

function toTimestamp(value) {
    if (value == null) return null;
    if (value && typeof value.toDate === 'function') return value;
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return admin.firestore.Timestamp.now();
    return admin.firestore.Timestamp.fromDate(d);
}

function serializeValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (Array.isArray(v)) return v.map(serializeValue);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        const o = {};
        for (const [k, val] of Object.entries(v)) {
            o[k] = serializeValue(val);
        }
        return o;
    }
    return v;
}

function serializeDoc(doc) {
    if (!doc.exists) return null;
    const data = serializeValue(doc.data());
    return { ...data, _id: doc.id };
}

/** Write helpers: plain Dates / ISO strings → Firestore Timestamp in known places */
function writeUser(user) {
    const u = { ...user };
    if (u.createdAt) u.createdAt = toTimestamp(u.createdAt);
    if (u.updatedAt) u.updatedAt = toTimestamp(u.updatedAt);
    return u;
}

function writeTrackingSession(session) {
    const s = JSON.parse(JSON.stringify(session));
    if (s.startTime) s.startTime = toTimestamp(s.startTime);
    if (s.endTime) s.endTime = s.endTime ? toTimestamp(s.endTime) : null;
    if (Array.isArray(s.locationHistory)) {
        s.locationHistory = s.locationHistory.map((p) => ({
            ...p,
            timestamp: p.timestamp ? toTimestamp(p.timestamp) : admin.firestore.Timestamp.now(),
        }));
    }
    if (Array.isArray(s.checkIns)) {
        s.checkIns = s.checkIns.map((c) => ({
            ...c,
            timestamp: c.timestamp ? toTimestamp(c.timestamp) : admin.firestore.Timestamp.now(),
        }));
    }
    if (Array.isArray(s.emergencyAlerts)) {
        s.emergencyAlerts = s.emergencyAlerts.map((e) => ({
            ...e,
            timestamp: e.timestamp ? toTimestamp(e.timestamp) : admin.firestore.Timestamp.now(),
        }));
    }
    return s;
}

function writeIncident(incident) {
    const i = JSON.parse(JSON.stringify(incident));
    if (i.incidentTime) i.incidentTime = toTimestamp(i.incidentTime);
    if (i.createdAt) i.createdAt = toTimestamp(i.createdAt);
    if (i.comments && Array.isArray(i.comments)) {
        i.comments = i.comments.map((c) => ({
            ...c,
            commentedAt: c.commentedAt ? toTimestamp(c.commentedAt) : admin.firestore.Timestamp.now(),
        }));
    }
    if (i.votedBy && Array.isArray(i.votedBy)) {
        i.votedBy = i.votedBy.map((v) => ({
            ...v,
            votedAt: v.votedAt ? toTimestamp(v.votedAt) : admin.firestore.Timestamp.now(),
        }));
    }
    return i;
}

/** Firestore forbids `undefined` in field values (often surfaces as a vague “invalid field” error). */
function stripUndefinedDeep(val) {
    if (val === undefined) return undefined;
    if (val === null) return null;
    if (val instanceof admin.firestore.Timestamp) return val;
    if (val && typeof val === 'object' && typeof val.toDate === 'function') return val;
    if (Array.isArray(val)) {
        return val
            .map((x) => stripUndefinedDeep(x))
            .filter((x) => x !== undefined);
    }
    if (typeof val === 'object' && val.constructor === Object) {
        const o = {};
        for (const [k, v] of Object.entries(val)) {
            if (v === undefined) continue;
            const nv = stripUndefinedDeep(v);
            if (nv !== undefined) o[k] = nv;
        }
        return o;
    }
    return val;
}

/**
 * Doc id is set separately; drop `_id` from body. Omit `coordinates` when missing so we never write null maps Firestore rejects in some cases.
 */
function sanitizeIncidentPayloadForFirestore(payload) {
    const p = stripUndefinedDeep(payload);
    delete p._id;
    if (p.location && typeof p.location === 'object') {
        const addr = p.location.address != null ? String(p.location.address) : '';
        const c = p.location.coordinates;
        const lat = c != null ? Number(c.latitude ?? c.lat) : NaN;
        const lng = c != null ? Number(c.longitude ?? c.lng) : NaN;
        const hasCoords =
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lng) <= 180;
        if (hasCoords) {
            p.location = {
                address: addr,
                coordinates: { latitude: lat, longitude: lng },
            };
        } else {
            p.location = { address: addr };
        }
    }
    return stripUndefinedDeep(p);
}

function writeCommunity(doc) {
    const c = { ...doc };
    if (c.createdAt) {
        c.createdAt =
            typeof c.createdAt === 'string'
                ? admin.firestore.Timestamp.fromDate(new Date(c.createdAt))
                : toTimestamp(c.createdAt);
    } else {
        c.createdAt = admin.firestore.Timestamp.now();
    }
    return c;
}

async function usersFindById(userId) {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.USERS).doc(userId).get();
    return serializeDoc(snap);
}

async function usersFindByEmail(email) {
    const db = firestoreOrThrow();
    const q = await db.collection(COL.USERS).where('email', '==', email).limit(1).get();
    if (q.empty) return null;
    return serializeDoc(q.docs[0]);
}

async function usersCreate(user) {
    const db = firestoreOrThrow();
    const payload = writeUser(user);
    await db.collection(COL.USERS).doc(user._id).set(payload);
    return user._id;
}

async function usersSave(user) {
    const db = firestoreOrThrow();
    const payload = writeUser(user);
    await db.collection(COL.USERS).doc(user._id).set(payload, { merge: true });
}

async function usersDelete(userId) {
    const db = firestoreOrThrow();
    await db.collection(COL.USERS).doc(userId).delete();
}

async function trackingCodeExists(code) {
    const db = firestoreOrThrow();
    const q = await db.collection(COL.TRACKING_SESSIONS).where('trackingCode', '==', code).limit(1).get();
    return !q.empty;
}

async function trackingCreate(session) {
    const db = firestoreOrThrow();
    const payload = writeTrackingSession(session);
    await db.collection(COL.TRACKING_SESSIONS).doc(session._id).set(payload);
}

async function trackingFindById(id) {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.TRACKING_SESSIONS).doc(id).get();
    return serializeDoc(snap);
}

async function trackingFindByCode(code) {
    const db = firestoreOrThrow();
    const upper = (code || '').toUpperCase();
    const q = await db.collection(COL.TRACKING_SESSIONS).where('trackingCode', '==', upper).limit(1).get();
    if (q.empty) return null;
    return serializeDoc(q.docs[0]);
}

async function trackingUpdate(session) {
    const db = firestoreOrThrow();
    const payload = writeTrackingSession(session);
    await db.collection(COL.TRACKING_SESSIONS).doc(session._id).set(payload, { merge: true });
}

async function trackingFindByUserId(userId, { limit = 10, status } = {}) {
    const db = firestoreOrThrow();
    let ref = db.collection(COL.TRACKING_SESSIONS).where('userId', '==', userId);
    if (status) ref = ref.where('status', '==', status);
    const snap = await ref.limit(200).get();
    let list = snap.docs.map((d) => serializeDoc(d));
    list.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    return list.slice(0, parseInt(limit, 10));
}

async function incidentsFetchAll(max = MAX_INCIDENT_SCAN) {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.INCIDENTS).limit(max).get();
    return snap.docs.map((d) => serializeDoc(d));
}

async function incidentsGetById(id) {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.INCIDENTS).doc(id).get();
    return serializeDoc(snap);
}

async function incidentsCreate(incident) {
    const db = firestoreOrThrow();
    const id = incident._id;
    const payload = sanitizeIncidentPayloadForFirestore(writeIncident(incident));
    await db.collection(COL.INCIDENTS).doc(id).set(payload);
    return id;
}

async function incidentsSave(incident) {
    const db = firestoreOrThrow();
    const payload = sanitizeIncidentPayloadForFirestore(writeIncident(incident));
    await db.collection(COL.INCIDENTS).doc(incident._id).set(payload, { merge: true });
}

async function communityInsert(doc) {
    const db = firestoreOrThrow();
    const id = doc._id;
    const payload = writeCommunity(doc);
    await db.collection(COL.COMMUNITY).doc(id).set(payload);
    return id;
}

async function communityFindByKind(kind, limit) {
    const db = firestoreOrThrow();
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const snap = await db.collection(COL.COMMUNITY).where('kind', '==', kind).limit(200).get();
    let rows = snap.docs.map((d) => serializeDoc(d));
    const toTime = (r) => {
        const c = r.createdAt;
        return c ? new Date(c).getTime() : 0;
    };
    rows.sort((a, b) => toTime(b) - toTime(a));
    return rows.slice(0, lim);
}

async function communityLikePost(docId, userId) {
    const db = firestoreOrThrow();
    const ref = db.collection(COL.COMMUNITY).doc(docId);
    const snap = await ref.get();
    if (!snap.exists) throw Object.assign(new Error('Post not found'), { statusCode: 404 });
    const data = snap.data();
    const likedBy = data.likedBy || [];
    const alreadyLiked = likedBy.includes(userId);
    if (alreadyLiked) {
        // toggle off
        await ref.update({
            likedBy: admin.firestore.FieldValue.arrayRemove(userId),
            likes: Math.max(0, (data.likes || 0) - 1),
        });
        return { liked: false, likes: Math.max(0, (data.likes || 0) - 1) };
    } else {
        await ref.update({
            likedBy: admin.firestore.FieldValue.arrayUnion(userId),
            likes: (data.likes || 0) + 1,
        });
        return { liked: true, likes: (data.likes || 0) + 1 };
    }
}

async function communityUpdateImageUrl(docId, imageUrl) {
    const db = firestoreOrThrow();
    await db.collection(COL.COMMUNITY).doc(docId).update({ imageUrl });
}

async function liveSessionCreate(session, docId) {
    const db = firestoreOrThrow();
    const payload = {
        userId: session.userId,
        trackingCode: session.trackingCode,
        name: session.name,
        email: session.email,
        source: session.source,
        destination: session.destination,
        transportMode: session.transportMode,
        pin: session.pin,
        emergencyContacts: session.emergencyContacts || [],
        isTrackingActive: session.isTrackingActive !== false,
        lastVerified: toTimestamp(session.lastVerified || new Date()),
        locationLogs: [],
        createdAt: toTimestamp(session.createdAt || new Date()),
    };
    await db.collection(COL.LIVE_TRACKER).doc(docId).set(payload);
}

async function liveSessionGetByUserId(userId) {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.LIVE_TRACKER).doc(userId).get();
    return serializeDoc(snap);
}

async function liveSessionFindByCode(code) {
    const db = firestoreOrThrow();
    const upper = (code || '').toUpperCase();
    const q = await db.collection(COL.LIVE_TRACKER).where('trackingCode', '==', upper).limit(1).get();
    if (q.empty) return null;
    return serializeDoc(q.docs[0]);
}

async function liveSessionSetVerified(userId) {
    const db = firestoreOrThrow();
    await db.collection(COL.LIVE_TRACKER).doc(userId).set(
        { lastVerified: admin.firestore.Timestamp.now() },
        { merge: true }
    );
}

async function liveSessionPushLocation(userId, lat, lng) {
    const db = firestoreOrThrow();
    const ref = db.collection(COL.LIVE_TRACKER).doc(userId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Session not found');
        const data = snap.data();
        const logs = Array.isArray(data.locationLogs) ? [...data.locationLogs] : [];
        logs.push({
            lat,
            lng,
            timestamp: admin.firestore.Timestamp.now(),
        });
        while (logs.length > MAX_LIVE_LOCATION_LOGS) logs.shift();
        tx.update(ref, { locationLogs: logs });
    });
}

async function liveSessionStop(userId) {
    const db = firestoreOrThrow();
    await db.collection(COL.LIVE_TRACKER).doc(userId).set({ isTrackingActive: false }, { merge: true });
}

async function safetyLocationsList() {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.SAFETY_LOCATIONS).get();
    return snap.docs.map((d) => {
        const row = d.data();
        return {
            id: d.id,
            latitude: row.latitude,
            longitude: row.longitude,
            risk_level: row.risk_level,
            location: row.location,
            category: row.category || 'unknown',
            last_updated: row.last_updated || '',
        };
    });
}

/**
 * Bulk-import an array of safety location objects into Firestore.
 * Uses batch writes with automatic 450-op chunking to stay within Firestore limits.
 * Returns { imported, skipped }.
 */
async function safetyLocationsBulkImport(entries) {
    const db = firestoreOrThrow();
    let imported = 0;
    let skipped  = 0;
    let batch = db.batch();
    let ops   = 0;

    for (const entry of entries) {
        const lat = parseFloat(entry.latitude);
        const lng = parseFloat(entry.longitude);
        const rsk = parseInt(entry.risk_level, 10);
        const loc = (entry.location || '').trim();

        if (isNaN(lat) || isNaN(lng) || isNaN(rsk) || !loc) { skipped++; continue; }
        if (rsk < 1 || rsk > 3) { skipped++; continue; }

        const ref = db.collection(COL.SAFETY_LOCATIONS).doc();
        batch.set(ref, {
            latitude:     lat,
            longitude:    lng,
            risk_level:   rsk,
            location:     loc,
            category:     (entry.category || 'csv_import').trim(),
            last_updated: (entry.last_updated || new Date().toISOString().split('T')[0]),
            source:       'admin_csv_upload',
            createdAt:    admin.firestore.Timestamp.now(),
        });
        imported++;
        ops++;

        if (ops >= 450) {
            await batch.commit();
            batch = db.batch();
            ops   = 0;
        }
    }
    if (ops > 0) await batch.commit();
    return { imported, skipped };
}

/**
 * Delete ALL documents in the safety_locations collection.
 * Used before a full CSV re-import so old data is replaced.
 * Returns { deleted }.
 */
async function safetyLocationsDeleteAll() {
    const db = firestoreOrThrow();
    let deleted = 0;
    let snap;
    do {
        snap = await db.collection(COL.SAFETY_LOCATIONS).limit(400).get();
        if (snap.empty) break;
        let batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
    } while (snap.size === 400);
    return { deleted };
}

async function safetyLocationsAdd(entry) {
    const db = firestoreOrThrow();
    const id = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    await db.collection(COL.SAFETY_LOCATIONS).doc(id).set({
        latitude: entry.latitude,
        longitude: entry.longitude,
        risk_level: entry.risk_level,
        location: entry.location,
        category: entry.category || 'incident',
        last_updated: entry.last_updated,
        createdAt: admin.firestore.Timestamp.now(),
    });
    return { id, ...entry };
}

let safetySeedPromise = null;

async function safetyLocationsSeedFromCsvIfEmpty() {
    const db = firestoreOrThrow();
    const snap = await db.collection(COL.SAFETY_LOCATIONS).limit(1).get();
    if (!snap.empty) return { seeded: false, count: 0 };

    if (safetySeedPromise) return safetySeedPromise;

    safetySeedPromise = (async () => {
        const csvPath = path.join(__dirname, '../data/safety_locations.csv');
        const locations = await new Promise((resolve, reject) => {
            const rows = [];
            createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => {
                    if (!row.latitude || !row.longitude || !row.risk_level || !row.location) return;
                    try {
                        rows.push({
                            latitude: parseFloat(row.latitude),
                            longitude: parseFloat(row.longitude),
                            risk_level: parseInt(row.risk_level, 10),
                            location: row.location.replace(/^"|"$/g, ''),
                            category: (row.category || 'unknown').replace(/^"|"$/g, ''),
                            last_updated: (row.last_updated || new Date().toISOString().split('T')[0]).replace(
                                /^"|"$/g,
                                ''
                            ),
                        });
                    } catch (_) {
                        /* skip */
                    }
                })
                .on('end', () => resolve(rows))
                .on('error', reject);
        });

        let batch = db.batch();
        let n = 0;
        let ops = 0;
        for (const loc of locations) {
            const ref = db.collection(COL.SAFETY_LOCATIONS).doc();
            batch.set(ref, {
                ...loc,
                createdAt: admin.firestore.Timestamp.now(),
            });
            n++;
            ops++;
            if (ops >= 450) {
                await batch.commit();
                batch = db.batch();
                ops = 0;
            }
        }
        if (ops > 0) await batch.commit();
        console.log(`🔥 Seeded ${n} safety locations from CSV into Firestore`);
        return { seeded: true, count: n };
    })().catch((err) => {
        console.warn('⚠️  Firestore safety location CSV seed skipped:', err.message);
        return { seeded: false, count: 0, error: err.message };
    });

    return safetySeedPromise;
}

function isFirestoreConfigured() {
    return !!getFirestoreAdmin();
}

// ─── SOS Events ───────────────────────────────────────────────────────────────

async function sosCreate(event) {
    const db = firestoreOrThrow();
    const id = event._id;
    const payload = { ...event };
    delete payload._id;
    if (payload.triggeredAt) payload.triggeredAt = toTimestamp(payload.triggeredAt);
    if (payload.expiresAt) payload.expiresAt = toTimestamp(payload.expiresAt);
    await db.collection(COL.SOS_EVENTS).doc(id).set(payload);
    return id;
}

async function sosFindActive(userId) {
    const db = firestoreOrThrow();
    const snap = await db
        .collection(COL.SOS_EVENTS)
        .where('userId', '==', userId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty) return null;
    return serializeDoc(snap.docs[0]);
}

async function sosMarkSafe(sosId, resolvedAt) {
    const db = firestoreOrThrow();
    await db.collection(COL.SOS_EVENTS).doc(sosId).set(
        { status: 'safe', resolvedAt: toTimestamp(resolvedAt || new Date()) },
        { merge: true }
    );
}

async function sosMarkExpired(sosId) {
    const db = firestoreOrThrow();
    await db.collection(COL.SOS_EVENTS).doc(sosId).set(
        { status: 'expired', resolvedAt: toTimestamp(new Date()) },
        { merge: true }
    );
}

async function sosFindByUserId(userId, limitN = 20) {
    const db = firestoreOrThrow();
    const snap = await db
        .collection(COL.SOS_EVENTS)
        .where('userId', '==', userId)
        .limit(Math.min(limitN, 100))
        .get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.triggeredAt || 0) - new Date(a.triggeredAt || 0));
    return rows;
}

/**
 * Fetch all live-tracking sessions that belong to a given user email.
 * Sessions are keyed by a timestamp ID and store `email` as a plain field.
 */
async function liveSessionsByEmail(email, limitN = 50) {
    const db = firestoreOrThrow();
    const snap = await db
        .collection(COL.LIVE_TRACKER)
        .where('email', '==', email)
        .limit(Math.min(limitN, 200))
        .get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return rows;
}

// ── Admin-only functions ───────────────────────────────────────────────────

async function usersListAll(limitN = 500) {
    const db  = firestoreOrThrow();
    const snap = await db.collection(COL.USERS).limit(Math.min(limitN, 1000)).get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return rows;
}

async function communityDeletePost(docId) {
    const db = firestoreOrThrow();
    await db.collection(COL.COMMUNITY).doc(docId).delete();
}

async function communityDeleteAlert(docId) {
    const db = firestoreOrThrow();
    await db.collection(COL.COMMUNITY).doc(docId).delete();
}

async function sosListAll(limitN = 200) {
    const db  = firestoreOrThrow();
    const snap = await db.collection(COL.SOS_EVENTS).limit(Math.min(limitN, 500)).get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.triggeredAt || 0) - new Date(a.triggeredAt || 0));
    return rows;
}

async function liveSessionsListAll(limitN = 100) {
    const db  = firestoreOrThrow();
    const snap = await db.collection(COL.LIVE_TRACKER).limit(Math.min(limitN, 200)).get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
    return rows;
}

async function adminLogCreate(entry) {
    const db = firestoreOrThrow();
    const id  = `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
    await db.collection('hershield_admin_logs').doc(id).set({
        ...entry,
        _id: id,
        timestamp: admin.firestore.Timestamp.now(),
    });
    return id;
}

async function adminLogsList(limitN = 100) {
    const db  = firestoreOrThrow();
    const snap = await db.collection('hershield_admin_logs').limit(Math.min(limitN, 200)).get();
    const rows = snap.docs.map((d) => serializeDoc(d));
    rows.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return rows;
}

async function getDashboardStats() {
    const db = firestoreOrThrow();

    // Helper: count documents in a collection efficiently.
    // Tries the Firestore aggregation API first (much cheaper), falls back to
    // fetching all doc IDs if the SDK version doesn't support aggregate().
    async function countCollection(colName) {
        try {
            const colRef = db.collection(colName);
            if (typeof colRef.count === 'function') {
                // Firestore v9+ aggregation — only reads metadata, not documents
                const snapshot = await colRef.count().get();
                return snapshot.data().count;
            }
            // Fallback: select only __name__ (cheapest field projection)
            const snap = await colRef.select('__name__').get();
            return snap.size;
        } catch (e) {
            console.warn(`getDashboardStats: count failed for ${colName}:`, e.message);
            return 0;
        }
    }

    const [communityMembers, totalSosAlerts, safeTrips, safeZones] = await Promise.all([
        countCollection(COL.USERS),
        countCollection(COL.SOS_EVENTS),
        countCollection(COL.LIVE_TRACKER),
        countCollection(COL.SAFETY_LOCATIONS),
    ]);

    return { communityMembers, totalSosAlerts, safeTrips, safeZones };
}

module.exports = {
    firestoreOrThrow,
    isFirestoreConfigured,
    COL,
    usersFindById,
    usersFindByEmail,
    usersCreate,
    usersSave,
    usersDelete,
    usersListAll,
    trackingCodeExists,
    trackingCreate,
    trackingFindById,
    trackingFindByCode,
    trackingUpdate,
    trackingFindByUserId,
    incidentsFetchAll,
    incidentsGetById,
    incidentsCreate,
    incidentsSave,
    communityInsert,
    communityFindByKind,
    communityLikePost,
    communityUpdateImageUrl,
    communityDeletePost,
    communityDeleteAlert,
    liveSessionCreate,
    liveSessionGetByUserId,
    liveSessionFindByCode,
    liveSessionSetVerified,
    liveSessionPushLocation,
    liveSessionStop,
    liveSessionsListAll,
    safetyLocationsList,
    safetyLocationsAdd,
    safetyLocationsBulkImport,
    safetyLocationsDeleteAll,
    safetyLocationsSeedFromCsvIfEmpty,
    sosCreate,
    sosFindActive,
    sosMarkSafe,
    sosMarkExpired,
    sosFindByUserId,
    liveSessionsByEmail,
    sosListAll,
    adminLogCreate,
    adminLogsList,
    getDashboardStats,
};

