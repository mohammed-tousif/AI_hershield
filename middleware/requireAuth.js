'use strict';
/**
 * Firebase ID Token Authentication Middleware — Her Shield
 * Verifies the `Authorization: Bearer <Firebase ID token>` header using
 * firebase-admin (the same service account already initialized for
 * Firestore in config/firestoreAdmin.js). Attaches req.authUser = { uid, email }.
 *
 * Used by the central API ownership boundary and authenticated routes.
 */
const { getFirestoreAdmin } = require('../config/firestoreAdmin');

async function requireAuth(req, res, next) {
    if (req.authUser) return next();
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    try {
        // Initialize only after a credential is supplied.
        getFirestoreAdmin();
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            return res.status(503).json({ success: false, message: 'Server authentication is not configured.' });
        }
        const decoded = await admin.auth().verifyIdToken(token, true);
        req.authUser = { uid: decoded.uid, email: decoded.email || null, name: decoded.name || '' };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }
}

module.exports = { requireAuth };
