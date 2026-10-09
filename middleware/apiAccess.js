'use strict';
const { requireAuth } = require('./requireAuth');
const repo = require('../services/firestoreRepository');
const { adminAuth } = require('./adminAuth');
const { rateLimit } = require('express-rate-limit');
const pinLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,
    keyGenerator: req => req.authUser.uid,
    message: { success: false, message: 'Too many PIN attempts. Try again in 15 minutes.' } });
const publicReads = new Set(['/health', '/dashboard/stats', '/legal/topics',
    '/community/posts', '/community/alerts', '/community/incident-reports',
    '/safety/heatmap', '/safety/incidents', '/safety/incident-points', '/safety/stats',
    '/safety/locations', '/safety/locations/stats']);
const hidden = new Set(['pin', 'pinHash', 'pinFailures', 'pinLockedUntil']);
const publicHidden = new Set(['reporter', 'reporterEmail', 'reporterName', 'reportedBy', 'reporterId', 'userEmail', 'userId', 'likedBy', 'votedBy', 'adminNotes', 'policeReportNumber', 'contactInfo']);
function clean(value, publicData = false) {
    if (Array.isArray(value)) return value.map(v => clean(v, publicData));
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !hidden.has(k) && !(publicData && publicHidden.has(k))).map(([k,v]) => [k, clean(v, publicData)]));
}
function denied(res) { return res.status(403).json({ success: false, message: 'You do not have access to this resource.' }); }
function apiAccess(req, res, next) {
    const publicData = /^(GET|HEAD)$/.test(req.method) && publicReads.has(req.path);
    const json = res.json.bind(res);
    res.json = value => json(clean(value, publicData));
    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/admin/')) return next(); // separate admin JWT router
    if (publicData || (/^(GET|HEAD)$/.test(req.method) && /^\/live-tracker\/view\/[A-F0-9]{64}$/.test(req.path))) return next();
    if (req.path === '/safety/locations' && req.method === 'POST') return adminAuth(req, res, next);
    return requireAuth(req, res, async () => {
        try {
            const uid = req.authUser.uid;
            const email = req.authUser.email || '';
            const parts = req.path.split('/').filter(Boolean).map(decodeURIComponent);
            const body = req.body || (req.body = {});
            const own = value => value === uid;
            const owned = s => s && (s.ownerUid || s.userId) === uid;
            if (parts[0] === 'users') {
                if (['profile','stats'].includes(parts[1]) && !own(parts[2])) return denied(res);
                if (parts[1] === 'email' && parts[2]?.toLowerCase() !== email.toLowerCase()) return denied(res);
                if (['upsert','register'].includes(parts[1])) {
                    if (body.firebaseUid && !own(body.firebaseUid)) return denied(res);
                    body.firebaseUid = uid; body.email = email;
                }
            }
            if (parts[0] === 'emergency') {
                const id = parts[1] === 'contacts' ? parts[2] : parts[1] === 'sos' ? parts[3] : null;
                if (id && !own(id)) return denied(res);
                if (body.userId && !own(body.userId)) return denied(res);
                if (req.method !== 'GET') body.userId = uid;
                if (body.sessionId && !owned(await repo.trackingFindById(body.sessionId))) return denied(res);
            }
            if (parts[0] === 'tracking') {
                if (body.userId && !own(body.userId)) return denied(res);
                if (parts[1] === 'user' && !own(parts[2])) return denied(res);
                if (parts[1] === 'start') body.userId = uid;
                const session = body.sessionId ? await repo.trackingFindById(body.sessionId)
                    : parts[1] === 'session' ? await repo.trackingFindById(parts[2])
                    : parts[1] === 'code' ? await repo.trackingFindByCode(parts[2]) : undefined;
                if (session !== undefined && !owned(session)) return denied(res);
            }
            if (parts[0] === 'live-tracker') {
                if (parts[1] === 'start') body.email = email || undefined;
                else if (parts[1] === 'dashboard-alert') {
                    if (body.userId && !own(body.userId)) return denied(res);
                    body.userId = uid; body.userEmail = email || undefined;
                } else if (parts[1] === 'history') {
                    if (!email || parts[2]?.toLowerCase() !== email.toLowerCase()) return denied(res);
                } else {
                    const s = parts[1] === 'lookup-code' ? await repo.liveSessionFindByCode(parts[2])
                        : await repo.liveSessionGetByUserId(parts[2] || body.userId || '__missing__');
                    // Email is not ownership; legacy sessions without an owner must be restarted.
                    if (!s || s.ownerUid !== uid) return denied(res);
                }
            }
            if (['safety','community'].includes(parts[0]) && req.method !== 'GET') {
                body.userId = uid; body.userEmail = email || undefined;
                body.userName = req.authUser.name || 'Community Member';
                body.reporter = { name: req.authUser.name || 'Community Member', email };
                body.reporterEmail = email; body.reporterId = uid;
            }
            if (req.path === '/legal/health') return denied(res);
            if (['/live-tracker/verify-pin','/live-tracker/stop','/emergency/sos/safe'].includes(req.path)) return pinLimit(req, res, next);
            return next();
        } catch (err) { return next(err); }
    });
}
module.exports = { apiAccess, clean };
