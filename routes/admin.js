'use strict';
/**
 * Admin API Routes — HerShield
 * All routes are protected by adminAuth JWT middleware.
 * Every write action is logged to hershield_admin_logs in Firestore.
 */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const { body, validationResult } = require('express-validator');
const { Readable } = require('stream');
const csvParser = require('csv-parser');
const router   = express.Router();
const { adminAuth, ADMIN_JWT_SECRET } = require('../middleware/adminAuth');
const { getStorageBucket } = require('../config/firestoreAdmin');
const { loginRateLimiter, loginBackoffGuard, recordLoginFailure, clearLoginFailures } = require('../middleware/loginThrottle');
const { stripHtml } = require('../services/sanitize');

const {
    isFirestoreConfigured,
    usersListAll,
    usersFindById,
    usersSave,
    usersDelete,
    incidentsFetchAll,
    incidentsDelete,
    communityFindByKind,
    communityInsert,
    communityDeletePost,
    communityDeleteAlert,
    sosListAll,
    sosFindActive,
    liveSessionsListAll,
    adminLogCreate,
    adminLogsList,
    safetyLocationsList,
    safetyLocationsBulkImport,
    safetyLocationsDeleteAll,
} = require('../services/firestoreRepository');

const smsService = require('../services/smsService');

// Multer: store in memory only, max 10 MB, CSV only
const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are accepted'));
        }
    },
});

// ── helpers ────────────────────────────────────────────────────────────────────
function getIo(req) { return req.app.get('io') || null; }

async function log(req, action, detail = {}) {
    try {
        await adminLogCreate({
            admin:  req.admin?.email || 'unknown',
            action,
            detail,
            ip:     req.ip,
        });
    } catch (_) { /* non-blocking */ }
}

/** Shared express-validator error responder — used by every validated route below. */
function checkValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg, details: errors.array() });
    }
    next();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/admin/login  (public — no auth)
//  Layered abuse protection: a stricter per-IP rate limit (10/min) plus
//  per-IP exponential backoff on consecutive failures — see
//  middleware/loginThrottle.js for why this is per-IP, not per-account.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/login', loginRateLimiter, loginBackoffGuard, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
        const ADMIN_HASH  = process.env.ADMIN_PASSWORD_HASH;

        if (!ADMIN_EMAIL || !ADMIN_HASH) {
            return res.status(503).json({
                success: false,
                message: 'Admin credentials not configured on server. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in .env',
            });
        }

        // Both branches below return the IDENTICAL message and both record a
        // failure — this is deliberate: never reveal whether the email or the
        // password was the wrong part (account-enumeration protection).
        if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
            recordLoginFailure(req);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, ADMIN_HASH);
        if (!valid) {
            recordLoginFailure(req);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        clearLoginFailures(req);

        const token = jwt.sign(
            { email: ADMIN_EMAIL, isAdmin: true, role: 'admin' },
            ADMIN_JWT_SECRET,
            { expiresIn: '2h' } // shortened from 10h — reduces the window a leaked token stays valid
        );

        res.json({ success: true, token, email: ADMIN_EMAIL });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── All routes below require valid admin JWT ───────────────────────────────────
router.use(adminAuth);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/stats', async (req, res) => {
    try {
        const [users, posts, alerts, incidents, sosList, activeSos, liveSessions] = await Promise.allSettled([
            usersListAll(1000),
            communityFindByKind('post', 200),
            communityFindByKind('alert', 200),
            incidentsFetchAll(200),
            sosListAll(200),
            sosFindActive(),
            liveSessionsListAll(100),
        ]);

        const val = (r) => (r.status === 'fulfilled' ? r.value : []);

        const sosData    = val(sosList);
        const activeNow  = (val(activeSos))?.userId ? [val(activeSos)] : (Array.isArray(val(activeSos)) ? val(activeSos) : []);
        const liveSess   = val(liveSessions);

        res.json({
            success: true,
            stats: {
                totalUsers:        val(users).length,
                totalPosts:        val(posts).length,
                totalAlerts:       val(alerts).length,
                totalIncidents:    val(incidents).length,
                totalSosEvents:    sosData.length,
                activeSosNow:      sosData.filter(s => s.status === 'active').length,
                activeTracking:    liveSess.filter(s => s.status === 'active').length,
                newUsersToday:     val(users).filter(u => {
                    const d = new Date(u.createdAt || 0);
                    return d.toDateString() === new Date().toDateString();
                }).length,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/users
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/users', async (req, res) => {
    try {
        const users = await usersListAll(500);
        // Strip password fields
        const safe = users.map(({ password, passwordHash, ...u }) => u);
        res.json({ success: true, users: safe });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/users/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/users/:id', async (req, res) => {
    try {
        const user = await usersFindById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const { password, passwordHash, ...safe } = user;
        res.json({ success: true, user: safe });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/admin/users/:id/deactivate
//  Body: { active: boolean } — toggles isActive AND the real Firebase Auth
//  account (disabled accounts can't sign in at all — isActive alone isn't
//  checked anywhere else in the app today, so both are kept in sync).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/users/:id/deactivate', async (req, res) => {
    try {
        const { active } = req.body || {};
        if (typeof active !== 'boolean') {
            return res.status(400).json({ success: false, message: '"active" (boolean) is required in the request body.' });
        }
        const user = await usersFindById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.isActive = active;
        user.updatedAt = new Date();
        await usersSave(user);

        let authUpdated = false;
        try {
            const admin = require('firebase-admin');
            if (admin.apps.length) {
                await admin.auth().updateUser(req.params.id, { disabled: !active });
                authUpdated = true;
            }
        } catch (authErr) {
            console.warn('[Admin] Could not update Firebase Auth disabled state:', authErr.message);
        }

        await log(req, active ? 'REACTIVATE_USER' : 'DEACTIVATE_USER', { userId: user._id, email: user.email, authUpdated });
        res.json({
            success: true,
            message: active
                ? (authUpdated ? 'Account reactivated.' : 'Account marked active, but re-enabling Firebase Auth failed — check server logs.')
                : (authUpdated ? 'Account deactivated.' : 'Account marked inactive, but disabling Firebase Auth failed — check server logs.'),
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/admin/users/:id
//  Permanently deletes the Firestore user doc, the Firebase Auth account,
//  and any verification selfie on disk. Does NOT cascade-delete the user's
//  community posts / incident reports / SOS history — those stay for
//  community/audit integrity, just detached from a live account.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/users/:id', async (req, res) => {
    try {
        const user = await usersFindById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.verificationSelfiePath) {
            const bucket = getStorageBucket();
            if (bucket) await bucket.file(user.verificationSelfiePath).delete().catch(() => {});
        }

        let authDeleted = false;
        try {
            const admin = require('firebase-admin');
            if (admin.apps.length) {
                await admin.auth().deleteUser(req.params.id);
                authDeleted = true;
            }
        } catch (authErr) {
            console.warn('[Admin] Could not delete Firebase Auth account:', authErr.message);
        }

        await usersDelete(req.params.id);

        await log(req, 'DELETE_USER', { userId: req.params.id, email: user.email, authDeleted });
        res.json({
            success: true,
            message: authDeleted
                ? 'User deleted (Firestore + Firebase Auth).'
                : 'User deleted from Firestore, but Firebase Auth deletion failed — check server logs.',
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GENDER VERIFICATION REVIEW QUEUE
//  Self-declaration + selfie + human review (NOT automated gender
//  detection, NOT a feature-access gate — see routes/verification.js).
//  Selfies live in Firebase Storage, not local disk — Render's filesystem
//  is ephemeral and wipes local files on every redeploy/restart.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/verifications', async (req, res) => {
    try {
        const status = (req.query.status || 'pending').toLowerCase();
        const users = await usersListAll(1000);
        const filtered = users
            .filter(u => (u.verificationStatus || 'unverified') === status)
            .map(({ password, passwordHash, ...u }) => u);
        res.json({ success: true, verifications: filtered });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Streams the selfie file — never exposed via public/static hosting, only
// reachable through this admin-authenticated route.
router.get('/verifications/:userId/selfie', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        if (!user || !user.verificationSelfiePath) {
            return res.status(404).json({ success: false, message: 'No selfie on file for this user.' });
        }
        const bucket = getStorageBucket();
        if (!bucket) {
            return res.status(503).json({ success: false, message: 'Photo storage is not configured on the server.' });
        }
        const file = bucket.file(user.verificationSelfiePath);
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Selfie file missing in storage.' });
        }
        const [buffer] = await file.download();
        const [metadata] = await file.getMetadata();
        res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
        res.send(buffer);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/verifications/:userId/approve', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.verificationStatus = 'verified';
        user.verificationReviewedAt = new Date();
        user.verificationReviewedBy = req.admin?.email || 'unknown';
        user.verificationRejectionReason = null;
        user.updatedAt = new Date();
        await usersSave(user);

        await log(req, 'APPROVE_VERIFICATION', { userId: user._id, email: user.email });
        res.json({ success: true, message: 'Verification approved.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

const rejectVerificationValidators = [
    body('reason').optional({ nullable: true }).isString().isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
    body('deactivate').optional({ nullable: true }).isBoolean().withMessage('deactivate must be boolean'),
];

router.post('/verifications/:userId/reject', rejectVerificationValidators, checkValidation, async (req, res) => {
    try {
        const { deactivate } = req.body || {};
        const reason = stripHtml((req.body || {}).reason || '');
        const user = await usersFindById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.verificationStatus = 'rejected';
        user.verificationReviewedAt = new Date();
        user.verificationReviewedBy = req.admin?.email || 'unknown';
        user.verificationRejectionReason = reason || 'Submission did not pass review.';

        let authDisabled = false;
        if (deactivate === true) {
            user.isActive = false;
            // isActive isn't checked anywhere else in the app today, so also disable
            // the actual Firebase Auth account — Firebase itself then refuses future
            // sign-ins (auth/user-disabled), which is real enforcement.
            try {
                const admin = require('firebase-admin');
                if (admin.apps.length) {
                    await admin.auth().updateUser(req.params.userId, { disabled: true });
                    authDisabled = true;
                }
            } catch (authErr) {
                console.warn('[Admin] Could not disable Firebase Auth account:', authErr.message);
            }
        }

        user.updatedAt = new Date();
        await usersSave(user);

        await log(req, 'REJECT_VERIFICATION', {
            userId: user._id, email: user.email, reason, deactivated: !!deactivate, authDisabled,
        });
        res.json({
            success: true,
            message: deactivate
                ? (authDisabled
                    ? 'Verification rejected and account disabled.'
                    : 'Verification rejected; account flagged inactive but Firebase Auth disable failed — check server logs.')
                : 'Verification rejected.',
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/posts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/posts', async (req, res) => {
    try {
        const posts = await communityFindByKind('post', 200);
        res.json({ success: true, posts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/admin/posts  (create broadcast post)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const adminPostValidators = [
    body('content').trim().notEmpty().withMessage('Content required').isLength({ max: 2000 }).withMessage('Content must be under 2000 characters'),
    body('category').optional({ nullable: true }).isIn(['general', 'alert', 'tip', 'experience', 'event', 'question']).withMessage('Invalid category'),
    body('location').optional({ nullable: true }).isString().isLength({ max: 200 }).withMessage('Location must be under 200 characters'),
];

router.post('/posts', adminPostValidators, checkValidation, async (req, res) => {
    try {
        const { content, category, location } = req.body;

        const post = {
            _id:       `${Date.now()}_admin_${Math.floor(Math.random() * 9999)}`,
            kind:      'post',
            content:   stripHtml(content.trim()),
            userName:  'HerShield Admin',
            userEmail: req.admin.email,
            location:  stripHtml(location || ''),
            imageUrl:  '',
            category:  category || 'alert',
            isAdminPost: true,
            likes:     0,
            likedBy:   [],
            comments:  0,
            createdAt: new Date().toISOString(),
        };

        await communityInsert(post);
        const io = getIo(req);
        if (io) io.emit('community:newPost', post);

        await log(req, 'CREATE_POST', { postId: post._id, category });
        res.status(201).json({ success: true, post });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/admin/posts/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/posts/:id', async (req, res) => {
    try {
        await communityDeletePost(req.params.id);
        const io = getIo(req);
        if (io) io.emit('community:postDeleted', { postId: req.params.id });
        await log(req, 'DELETE_POST', { postId: req.params.id });
        res.json({ success: true, message: 'Post deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/alerts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/alerts', async (req, res) => {
    try {
        const [communityAlerts, incidents] = await Promise.all([
            communityFindByKind('alert', 100),
            incidentsFetchAll(100),
        ]);
        const incidentAlerts = incidents.map(inc => ({
            _id:      inc._id,
            kind:     'alert',
            source:   'incident-report',
            title:    `${inc.incidentType || 'Incident'} — ${(inc.severity || 'medium').toUpperCase()}`,
            message:  inc.description || '',
            severity: inc.severity || 'medium',
            location: inc?.location?.address || '',
            userName: inc.reporterName || 'Anonymous',
            createdAt: inc.createdAt,
        }));
        const all = [...communityAlerts, ...incidentAlerts]
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, alerts: all });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/admin/alerts/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/alerts/:id', async (req, res) => {
    try {
        await communityDeleteAlert(req.params.id);
        await log(req, 'DELETE_ALERT', { alertId: req.params.id });
        res.json({ success: true, message: 'Alert deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/incidents
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/incidents', async (req, res) => {
    try {
        const incidents = await incidentsFetchAll(500);
        incidents.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
        res.json({ success: true, incidents });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DELETE /api/admin/incidents/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/incidents/:id', async (req, res) => {
    try {
        await incidentsDelete(req.params.id);
        await log(req, 'DELETE_INCIDENT', { incidentId: req.params.id });
        res.json({ success: true, message: 'Incident deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/sos
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/sos', async (req, res) => {
    try {
        const events = await sosListAll(300);
        res.json({ success: true, events });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/tracking', async (req, res) => {
    try {
        const sessions = await liveSessionsListAll(100);
        res.json({ success: true, sessions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  POST /api/admin/broadcast  (push alert to ALL users via Socket.IO)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const broadcastValidators = [
    body('title').trim().notEmpty().withMessage('Title required').isLength({ max: 200 }).withMessage('Title must be under 200 characters'),
    body('message').trim().notEmpty().withMessage('Message required').isLength({ max: 2000 }).withMessage('Message must be under 2000 characters'),
    body('severity').optional({ nullable: true }).isIn(['info', 'low', 'medium', 'high', 'critical']).withMessage('Invalid severity'),
    body('location').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('saveAsAlert').optional({ nullable: true }).isBoolean().withMessage('saveAsAlert must be boolean'),
];

router.post('/broadcast', broadcastValidators, checkValidation, async (req, res) => {
    try {
        const title    = stripHtml(req.body.title);
        const message  = stripHtml(req.body.message);
        const location = stripHtml(req.body.location || '');
        const { severity, saveAsAlert } = req.body;

        const payload = {
            _id:      `bcast_${Date.now()}`,
            title,
            message,
            severity: severity || 'info',
            location: location || '',
            sentBy:   req.admin.email,
            sentAt:   new Date().toISOString(),
        };

        // Push to ALL connected clients instantly
        const io = getIo(req);
        if (io) {
            io.emit('admin:broadcast', payload);
            console.log(`📢 Admin broadcast sent: "${title}" to ${io.engine.clientsCount} clients`);
        }

        // Optionally persist as a community alert
        if (saveAsAlert) {
            const alertDoc = {
                _id:       payload._id,
                kind:      'alert',
                title,
                message,
                severity:  severity || 'medium',
                location:  location || '',
                source:    'admin-broadcast',
                userName:  'HerShield Admin',
                userEmail: req.admin.email,
                createdAt: new Date().toISOString(),
            };
            await communityInsert(alertDoc);
            if (io) io.emit('community:newAlert', alertDoc);
        }

        await log(req, 'BROADCAST', { title, severity });
        res.json({ success: true, message: 'Broadcast sent', connectedClients: io?.engine?.clientsCount || 0 });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GET /api/admin/logs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/logs', async (req, res) => {
    try {
        const logs = await adminLogsList(100);
        res.json({ success: true, logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SAFETY DATA — CSV UPLOAD & MANAGEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/admin/safety-data/template
 * Returns a blank CSV template the admin can fill in
 */
router.get('/safety-data/template', (req, res) => {
    const header = 'latitude,longitude,risk_level,location,category\n';
    const sample = [
        '12.9716,77.5946,2,"Bangalore - MG Road",incident',
        '15.3573,75.1232,3,"Hubli - Railway Station",transport',
        '13.0827,80.2707,1,"Chennai - Safe Zone",safe',
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hershield_safety_template.csv"');
    res.send(header + sample + '\n');
});

/**
 * GET /api/admin/safety-data/stats
 * Returns count of safety locations grouped by risk level
 */
router.get('/safety-data/stats', async (req, res) => {
    try {
        const locs = await safetyLocationsList(5000);
        const stats = {
            total:  locs.length,
            high:   locs.filter(l => l.risk_level === 3).length,
            medium: locs.filter(l => l.risk_level === 2).length,
            low:    locs.filter(l => l.risk_level === 1).length,
            byCategory: {},
        };
        locs.forEach(l => {
            const cat = l.category || 'unknown';
            stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
        });
        res.json({ success: true, ...stats });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * POST /api/admin/safety-data/upload
 * Accepts multipart CSV file, parses it in-memory, batch-writes to Firestore.
 * Query param ?mode=replace  wipes existing data first (default: append)
 */
router.post(
    '/safety-data/upload',
    csvUpload.single('csvFile'),
    async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No CSV file provided. Field name must be "csvFile".' });
        }

        const mode = (req.query.mode || 'append').toLowerCase(); // 'replace' | 'append'

        try {
            // ── 1. Parse CSV from buffer ──────────────────────────────────
            const rows = await new Promise((resolve, reject) => {
                const results = [];
                const stream  = Readable.from(req.file.buffer.toString('utf8'));
                stream
                    .pipe(csvParser({ skipLines: 0 }))
                    .on('data', row => {
                        // Skip comment lines (rows where latitude starts with #)
                        const lat = (row.latitude || '').trim();
                        if (!lat || lat.startsWith('#')) return;
                        results.push(row);
                    })
                    .on('end', () => resolve(results))
                    .on('error', reject);
            });

            if (rows.length === 0) {
                return res.status(422).json({
                    success: false,
                    message: 'CSV parsed successfully but contains no valid data rows. Check headers: latitude,longitude,risk_level,location',
                });
            }

            // ── 2. Optional: wipe existing data ───────────────────────────
            let deleted = 0;
            if (mode === 'replace') {
                const result = await safetyLocationsDeleteAll();
                deleted = result.deleted;
                console.log(`🗑️  Admin CSV upload (replace mode): deleted ${deleted} existing records`);
            }

            // ── 3. Batch import to Firestore ──────────────────────────────
            const { imported, skipped } = await safetyLocationsBulkImport(rows);

            // ── 4. Broadcast via Socket.IO so live map refreshes ──────────
            const io = getIo(req);
            if (io) {
                io.emit('safetyData:updated', {
                    mode,
                    imported,
                    skipped,
                    deleted,
                    timestamp: new Date().toISOString(),
                });
                console.log(`📡 Broadcast safetyData:updated to ${io.engine.clientsCount} clients`);
            }

            // ── 5. Audit log ──────────────────────────────────────────────
            await log(req, 'CSV_SAFETY_UPLOAD', {
                filename: req.file.originalname,
                mode,
                imported,
                skipped,
                deleted,
                sizeBytes: req.file.size,
            });

            console.log(`✅ Safety CSV imported: ${imported} rows, ${skipped} skipped (mode: ${mode})`);

            res.json({
                success:  true,
                message:  `Import complete: ${imported} records imported, ${skipped} skipped${mode === 'replace' ? `, ${deleted} old records deleted` : ''}.`,
                imported,
                skipped,
                deleted,
                mode,
                filename: req.file.originalname,
            });

        } catch (err) {
            console.error('❌ CSV upload error:', err);
            res.status(500).json({ success: false, message: err.message });
        }
    }
);

/**
 * DELETE /api/admin/safety-data
 * Wipes ALL safety location records (use before a full re-import)
 */
router.delete('/safety-data', async (req, res) => {
    try {
        const { deleted } = await safetyLocationsDeleteAll();
        await log(req, 'DELETE_ALL_SAFETY_DATA', { deleted });
        const io = getIo(req);
        if (io) io.emit('safetyData:updated', { mode: 'wipe', imported: 0, deleted, timestamp: new Date().toISOString() });
        res.json({ success: true, message: `Deleted ${deleted} safety location records.`, deleted });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SMS — Admin endpoints
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/admin/sms/status
 * Returns current Twilio configuration status (no secrets).
 */
router.get('/sms/status', (req, res) => {
    res.json({ success: true, sms: smsService.status() });
});

/**
 * POST /api/admin/sms/test
 * Body: { phone: "+919876543210" }
 * Sends a test SMS to the given number so the admin can verify Twilio works.
 */
router.post('/sms/test', async (req, res) => {
    const { phone } = req.body || {};
    if (!phone) {
        return res.status(400).json({ success: false, message: '"phone" is required in request body' });
    }
    try {
        const result = await smsService.testSend(phone);
        await log(req, 'SMS_TEST', { phone, success: result.success, sid: result.sid || null });
        const statusCode = result.success ? 200 : 422;
        return res.status(statusCode).json({ success: result.success, result });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
