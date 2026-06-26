/**
 * Community API routes — Her Shield
 * Handles posts, image uploads (local storage via multer), likes, and alerts.
 * Broadcasts new posts in real-time via Socket.IO.
 */
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const {
    communityInsert,
    communityFindByKind,
    communityLikePost,
    incidentsFetchAll,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');

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
router.post('/posts', async (req, res) => {
    try {
        const { content, userName, userEmail, location, imageUrl, category } = req.body;
        if (!content?.trim()) return res.status(400).json({ success: false, message: 'Content is required' });

        const post = {
            _id:       `${Date.now()}_${Math.floor(Math.random() * 99999)}`,
            kind:      'post',
            content:   content.trim(),
            userName:  userName  || 'Community Member',
            userEmail: userEmail || '',
            location:  location  || '',
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
router.post('/posts/upload', upload.single('image'), async (req, res) => {
    try {
        const { content, userName, userEmail, location, category } = req.body;
        if (!content?.trim()) return res.status(400).json({ success: false, message: 'Content is required' });

        // Build public URL for the uploaded file
        const imageUrl = req.file
            ? `/uploads/community/${req.file.filename}`
            : (req.body.imageUrl || '');

        const post = {
            _id:       `${Date.now()}_${Math.floor(Math.random() * 99999)}`,
            kind:      'post',
            content:   content.trim(),
            userName:  userName  || 'Community Member',
            userEmail: userEmail || '',
            location:  location  || '',
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
router.post('/posts/:id/like', async (req, res) => {
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
router.post('/alerts', async (req, res) => {
    try {
        const { title, message, severity, location, source, userName } = req.body;
        if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message are required' });

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
        const alerts = await communityFindByKind('alert', limit);

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
                    userName:  inc.reporterName || 'Anonymous',
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
                reporterName: inc.reporterName || 'Anonymous',
                createdAt:    inc.createdAt || inc.timestamp || new Date().toISOString(),
            }));

        res.json({ success: true, reports, count: reports.length });
    } catch (err) {
        console.error('GET /community/incident-reports error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

module.exports = router;
