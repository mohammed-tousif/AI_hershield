'use strict';
/**
 * routes/verification.js
 * ------------------------
 * Gender verification for HerShield signup: self-declaration + selfie +
 * human admin review (see routes/admin.js "GENDER VERIFICATION REVIEW QUEUE").
 *
 * IMPORTANT — this does NOT cryptographically prove gender. There is no
 * privacy-respecting way to do that without invasive government-ID KYC,
 * which is explicitly out of scope for this app. This feature raises the
 * cost of impersonation via a binding declaration (see auth.html signup
 * terms) plus a human reviewing a submitted selfie — nothing here is
 * automated gender classification, and nothing gates feature access by
 * verification status (verification here informs admin moderation, not
 * automatic access control — Emergency/SOS is never touched by this).
 *
 * Selfies are stored in Firebase Cloud Storage, NOT local disk — Render's
 * filesystem is ephemeral and wipes local files on every redeploy/restart,
 * which silently broke selfie viewing in an earlier version of this file.
 *
 * Routes:
 *   POST /api/verification/submit  — upload a selfie, sets status 'pending'
 *   GET  /api/verification/status  — the caller's own verification status
 */
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const { getStorageBucket } = require('../config/firestoreAdmin');
const { usersFindById, usersSave } = require('../services/firestoreRepository');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed (jpg, png, webp)'));
        }
    },
});

// ── POST /submit ───────────────────────────────────────────────────────────
router.post('/submit', requireAuth, upload.single('selfie'), async (req, res) => {
    try {
        const { uid } = req.authUser;
        const user = await usersFindById(uid);
        if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });

        if (user.verificationStatus === 'pending' || user.verificationStatus === 'verified') {
            return res.status(409).json({
                success: false,
                message: `Your account is already ${user.verificationStatus}. No need to resubmit.`,
            });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'A selfie image is required (field name "selfie").' });
        }

        const bucket = getStorageBucket();
        if (!bucket) {
            return res.status(503).json({ success: false, message: 'Photo storage is not configured on the server.' });
        }

        // Clean up a previous rejected-attempt file, if any.
        if (user.verificationSelfiePath) {
            await bucket.file(user.verificationSelfiePath).delete().catch(() => {});
        }

        const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        // Keyed by the *verified* Firebase uid (from requireAuth), not anything
        // client-supplied. Not under a publicly-served prefix — only reachable
        // via the admin-authenticated streaming route in routes/admin.js.
        const storagePath = `verification-selfies/${uid}_${Date.now()}${ext}`;
        await bucket.file(storagePath).save(req.file.buffer, {
            metadata: { contentType: req.file.mimetype },
        });

        user.verificationStatus = 'pending';
        user.verificationSelfiePath = storagePath;
        user.verificationSubmittedAt = new Date();
        user.verificationRejectionReason = null;
        user.updatedAt = new Date();
        await usersSave(user);

        res.json({ success: true, verificationStatus: 'pending' });
    } catch (err) {
        console.error('[Verification] submit error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to submit verification.' });
    }
});

// ── GET /status ────────────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
    try {
        const user = await usersFindById(req.authUser.uid);
        if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });
        res.json({
            success: true,
            verificationStatus: user.verificationStatus || 'unverified',
            verificationRejectionReason: user.verificationRejectionReason || null,
            // Only true for accounts created after the mandatory-verification-at-signup
            // rollout (routes/users.js POST /upsert) — existing accounts never get this
            // field, so auth.html's post-login redirect leaves them ungated.
            verificationGateRequired: !!user.verificationGateRequired,
        });
    } catch (err) {
        res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

module.exports = router;
