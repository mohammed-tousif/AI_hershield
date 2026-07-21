/**
 * Community API routes — Her Shield
 * Handles posts, image uploads (local storage via multer), likes, and alerts.
 * Broadcasts new posts in real-time via Socket.IO.
 */
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const router  = express.Router();

const {
    communityInsert,
    communityFindByKind,
    communityLikePost,
    incidentsFetchAll,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');
const { stripHtml } = require('../services/sanitize');

const VALID_CATEGORIES = ['general', 'alert', 'tip', 'experience', 'event', 'question'];

function checkValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: errors.array()[0].msg, details: errors.array() });
    }
    next();
}

const postValidators = [
    body('content').trim().notEmpty().withMessage('Content is required').isLength({ max: 2000 }).withMessage('Content must be under 2000 characters'),
    body('userName').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('Name must be under 100 characters'),
    body('userEmail').optional({ nullable: true }).isEmail().withMessage('Invalid email').normalizeEmail(),
    body('location').optional({ nullable: true }).isString().isLength({ max: 200 }).withMessage('Location must be under 200 characters'),
    body('imageUrl').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('category').optional({ nullable: true }).isIn(VALID_CATEGORIES).withMessage('Invalid category'),
];

const likeValidators = [
    body('userEmail').optional({ nullable: true }).isEmail().withMessage('Invalid email').normalizeEmail(),
    body('userId').optional({ nullable: true }).isString().isLength({ max: 200 }),
];

const alertValidators = [
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }).withMessage('Title must be under 200 characters'),
    body('message').trim().notEmpty().withMessage('Message is required').isLength({ max: 2000 }).withMessage('Message must be under 2000 characters'),
    body('severity').optional({ nullable: true }).isIn(['info', 'low', 'medium', 'high', 'critical']).withMessage('Invalid severity'),
    body('location').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('source').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('userName').optional({ nullable: true }).isString().isLength({ max: 100 }),
];

// ── Uploads directory ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'community');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Multer storage: disk, organised by date ───────────────────────────────────
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename:    (_req,  file, cb) => {
        const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
        const name = `post_${Date.now()}_${Math.floor(Math.random() * 9999)}${ext}`;
        cb(null, name);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) &&
            allowed.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
        }
    },
});

// Helper: get socket.io instance attached to the app by server.js
function getIo(req) { return req.app.get('io') || null; }

// ── GET /posts ─────────────────────────────────────────────────────────────────
router.get('/posts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '50', 10);
        if (!isFirestoreConfigured()) {
            return res.json({ success: true, posts: [], degraded: true,
                message: 'Firestore not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH.' });
        }
        const posts = await communityFindByKind('post', limit);
        res.json({ success: true, posts });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── POST /posts  (JSON body — text + optional imageUrl) ───────────────────────
router.post('/posts', postValidators, checkValidation, async (req, res) => {
    try {
        const { content, userName, userEmail, location, imageUrl, category } = req.body;

        const post = {
            _id:       `${Date.now()}_${Math.floor(Math.random() * 99999)}`,
            kind:      'post',
            content:   stripHtml(content.trim()),
            userName:  stripHtml(userName || 'Community Member'),
            userEmail: userEmail || '',
            location:  stripHtml(location || ''),
            imageUrl:  imageUrl  || '',
            category:  category  || 'general',
            likes:     0,
            likedBy:   [],
            comments:  0,
            createdAt: new Date().toISOString(),
        };

        await communityInsert(post);

        // Broadcast to all connected clients
        const io = getIo(req);
        if (io) io.emit('community:newPost', post);

        res.status(201).json({ success: true, post });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── POST /posts/upload  (multipart/form-data with image file) ─────────────────
router.post('/posts/upload', upload.single('image'), postValidators, checkValidation, async (req, res) => {
    try {
        const { content, userName, userEmail, location, category } = req.body;

        // Build public URL for the uploaded file
        const imageUrl = req.file
            ? `/uploads/community/${req.file.filename}`
            : (req.body.imageUrl || '');

        const post = {
            _id:       `${Date.now()}_${Math.floor(Math.random() * 99999)}`,
            kind:      'post',
            content:   stripHtml(content.trim()),
            userName:  stripHtml(userName || 'Community Member'),
            userEmail: userEmail || '',
            location:  stripHtml(location || ''),
            imageUrl,
            category:  category  || 'general',
            likes:     0,
            likedBy:   [],
            comments:  0,
            createdAt: new Date().toISOString(),
        };

        await communityInsert(post);

        const io = getIo(req);
        if (io) io.emit('community:newPost', post);

        res.status(201).json({ success: true, post });
    } catch (err) {
        // Remove uploaded file on error
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── POST /posts/:id/like ──────────────────────────────────────────────────────
router.post('/posts/:id/like', likeValidators, checkValidation, async (req, res) => {
    try {
        const { id } = req.params;
        // accept userEmail OR userId — email is the stable identifier in this app
        const userId  = req.body.userEmail || req.body.userId || 'anonymous';
        const result  = await communityLikePost(id, userId);

        const io = getIo(req);
        if (io) io.emit('community:likeUpdate', { postId: id, ...result });

        res.json({ success: true, ...result });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── POST /alerts ──────────────────────────────────────────────────────────────
router.post('/alerts', alertValidators, checkValidation, async (req, res) => {
    try {
        const title    = stripHtml(req.body.title);
        const message  = stripHtml(req.body.message);
        const location = stripHtml(req.body.location || '');
        const source   = stripHtml(req.body.source || '');
        const userName = stripHtml(req.body.userName || '');
        const { severity } = req.body;

        const alert = {
            _id:       `${Date.now()}_${Math.floor(Math.random() * 99999)}`,
            kind:      'alert',
            title, message,
            severity:  severity || 'medium',
            location:  location || '',
            source:    source   || 'dashboard',
            userName:  userName || 'HerShield User',
            createdAt: new Date().toISOString(),
        };

        await communityInsert(alert);

        const io = getIo(req);
        if (io) io.emit('community:newAlert', alert);

        res.status(201).json({ success: true, alert });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── GET /alerts ───────────────────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '20', 10);
        if (!isFirestoreConfigured()) {
            return res.json({ success: true, alerts: [], degraded: true,
                message: 'Firestore not configured.' });
        }
        let alerts = await communityFindByKind('alert', limit);
        // Filter out personal "Emergency Alert: <name>" entries that an older
        // version of the dashboard's Emergency Alert flow used to publish here —
        // those were private, per-user emergency triggers that should never have
        // been shown in a public community feed with the user's name attached.
        // New alerts are no longer written this way; this only cleans up any
        // that already exist in Firestore from before the fix.
        alerts = alerts.filter(a => !(a.title || '').startsWith('Emergency Alert:'));

        let incidentAlerts = [];
        try {
            const all = await incidentsFetchAll();
            incidentAlerts = all
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                .slice(0, limit)
                .map(inc => ({
                    _id:       inc._id,
                    kind:      'alert',
                    title:     `${inc.incidentType || 'Incident'} — ${(inc.severity || 'medium').toUpperCase()}`,
                    message:   inc.description || 'Community safety incident reported',
                    severity:  (inc.severity || 'medium').toLowerCase(),
                    location:  inc?.location?.address || '',
                    source:    'incident-report',
                    // The real reporter name is intentionally NOT exposed here — this is
                    // a public, community-wide feed. Only the admin panel (routes/admin.js,
                    // which reads incidentsFetchAll() directly) shows the real reporterName.
                    userName:  'HerShield User',
                    createdAt: inc.createdAt || new Date().toISOString(),
                }));
        } catch (_) { /* incidents optional */ }

        const merged = [...alerts, ...incidentAlerts]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);

        res.json({ success: true, alerts: merged });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

// ── GET /incident-reports ─────────────────────────────────────────────────────
/**
 * Public feed of community-submitted safety incident reports.
 * These come exclusively from the dashboard "Report Issue" form →
 * POST /api/safety/report → stored in hershield_incidents.
 *
 * This endpoint is the ONLY data source for the "Recent Alerts" section.
 * Emergency SOS events are intentionally excluded — they belong only in
 * the private "My Emergency Alert History" panel.
 */
router.get('/incident-reports', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);

        if (!isFirestoreConfigured()) {
            return res.json({ success: true, reports: [], degraded: true,
                message: 'Firestore not configured.' });
        }

        const SEVERITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
        const TYPE_LABELS = {
            harassment:          'Harassment',
            assault:             'Assault',
            theft:               'Theft',
            suspicious_activity: 'Suspicious Activity',
            poor_lighting:       'Poor Lighting',
            unsafe_area:         'Unsafe Area',
            other:               'Other',
        };

        const all = await incidentsFetchAll();
        const reports = all
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, limit)
            .map((inc) => ({
                _id:          inc._id,
                incidentType: inc.incidentType || 'other',
                typeLabel:    TYPE_LABELS[inc.incidentType] || inc.incidentType || 'Incident',
                severity:     (inc.severity || 'medium').toLowerCase(),
                severityLabel: SEVERITY_LABELS[(inc.severity || 'medium').toLowerCase()] || 'Medium',
                location:     inc?.location?.address || '',
                description:  (inc.description || '').slice(0, 200),
                // Real reporter name intentionally withheld from this public feed — only
                // the admin panel (which reads incidentsFetchAll() directly) sees it.
                reporterName: 'HerShield User',
                createdAt:    inc.createdAt || inc.timestamp || new Date().toISOString(),
            }));

        res.json({ success: true, reports, count: reports.length });
    } catch (err) {
        console.error('GET /community/incident-reports error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

module.exports = router;
