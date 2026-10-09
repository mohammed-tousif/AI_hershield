'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { getFirestoreAdmin } = require('../config/firestoreAdmin');
const { createEmailVerificationService } = require('../services/emailVerification');
const router = express.Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
for (const [method, path, action] of [['get', '/status', 'status'], ['post', '/send', 'send'], ['post', '/verify', 'verify']]) {
    router[method](path, async (req, res) => {
        try {
            const db = getFirestoreAdmin();
            if (!db) return res.status(503).json({ success: false, message: 'Email verification is temporarily unavailable.' });
            const service = createEmailVerificationService({ db, auth: require('firebase-admin').auth(), mailer: require('../services/emailService') });
            const result = await service[action](req.authUser, req.body?.code);
            if (result.body.retryAfter) res.set('Retry-After', String(result.body.retryAfter));
            res.status(result.status).json(result.body);
        } catch (error) {
            const known = [400, 401, 409].includes(error.status);
            res.status(known ? error.status : 503).json({ success: false, message: known ? error.message : 'Email verification is temporarily unavailable. Please retry.' });
        }
    });
}
module.exports = router;
