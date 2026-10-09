'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const repository = require('./firestoreRepository');
const TOKEN_PATTERN = /^[A-F0-9]{64}$/;
const newShareCode = () => crypto.randomBytes(32).toString('hex').toUpperCase();
const shareExpiresAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const hashPin = pin => bcrypt.hash(String(pin), 12);
async function verifyPin(pin, hash) {
    // Legacy unsalted hashes/plaintext sessions must be restarted; never downgrade.
    return typeof hash === 'string' && /^\$2[aby]\$/.test(hash) && bcrypt.compare(String(pin), hash);
}
function isLive(session) {
    return !!session && (session.isTrackingActive === true || session.status === 'active')
        && Number.isFinite(Date.parse(session.shareExpiresAt)) && Date.parse(session.shareExpiresAt) > Date.now();
}
async function findSharedSession(code) {
    if (!TOKEN_PATTERN.test(String(code || ''))) return null;
    const session = await repository.liveSessionFindByCode(code) || await repository.trackingFindByCode(code);
    return isLive(session) ? session : null;
}
function viewerLocation(session) {
    const p = session.locationLogs?.at(-1) || session.currentLocation;
    return {
        success: true, active: true, sessionId: session._id || session.userId,
        lat: p?.lat ?? p?.latitude ?? null, lng: p?.lng ?? p?.longitude ?? null,
        accuracy: p?.accuracy ?? null, timestamp: p?.timestamp || null,
        expiresAt: session.shareExpiresAt,
    };
}
function endViewers(io, id) {
    if (!io) return;
    const room = 'tracking:' + id;
    io.to(room).emit('sessionEnded', { sessionId: id });
    io.in(room).socketsLeave(room);
}
module.exports = { newShareCode, shareExpiresAt, hashPin, verifyPin, isLive, findSharedSession, viewerLocation, endViewers };
