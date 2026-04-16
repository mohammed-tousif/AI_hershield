'use strict';
/**
 * Admin JWT Authentication Middleware — Her Shield
 * Protects all /api/admin/* routes. Verifies the Bearer token
 * signed with ADMIN_JWT_SECRET (separate from user token).
 */
const jwt = require('jsonwebtoken');

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'hershield_ADMIN_secret_change_me';

function adminAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ success: false, message: 'Admin token required' });
    }

    try {
        const payload = jwt.verify(token, ADMIN_JWT_SECRET);
        if (!payload.isAdmin) {
            return res.status(403).json({ success: false, message: 'Not an admin token' });
        }
        req.admin = payload;
        next();
    } catch (err) {
        const msg = err.name === 'TokenExpiredError' ? 'Admin session expired' : 'Invalid admin token';
        return res.status(401).json({ success: false, message: msg });
    }
}

module.exports = { adminAuth, ADMIN_JWT_SECRET };
