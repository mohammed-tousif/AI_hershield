'use strict';
/**
 * Firebase ID Token Authentication Middleware — Her Shield
 * Verifies the `Authorization: Bearer <Firebase ID token>` header using
 * firebase-admin (the same service account already initialized for
 * Firestore in config/firestoreAdmin.js). Attaches req.authUser = { uid, email }.
 *
 * Unlike most routes in this app (which trust a client-supplied userId/email
 * in the request body), this establishes a real, unspoofable identity —
 * required wherever an action needs to be trustworthy attributed to a
 * specific account (e.g. gender-verification submissions).
 */
const { getFirestoreAdmin } = require('../config/firestoreAdmin');

async function requireAuth(req, res, next) {
    // Idempotent — ensures the firebase-admin default app is initialized.
    getFirestoreAdmin();

    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            return res.status(503).json({ success: false, message: 'Server authentication is not configured.' });
        }
        const decoded = await admin.auth().verifyIdToken(token);
        req.authUser = { uid: decoded.uid, email: decoded.email || null };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }
}

module.exports = { requireAuth };
