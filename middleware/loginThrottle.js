'use strict';
/**
 * Login-specific abuse protection for POST /api/admin/login, layered on top
 * of the general adminLimiter (60 req/min across all /api/admin/* — sized
 * for the admin dashboard's own polling, not for a login endpoint).
 *
 * Two layers:
 *   1. loginRateLimiter — a dedicated, stricter cap (10 req/min per IP) that
 *      catches rapid-fire automated guessing.
 *   2. loginBackoffGuard — per-IP exponential backoff on consecutive
 *      failures (1s, 2s, 4s, 8s... capped at 30s, reset on success) that
 *      catches slower, distributed-over-time brute force that stays under
 *      the rate limit.
 *
 * Deliberately per-IP, not per-account: there is exactly one admin account,
 * so a per-account lockout would let anyone who knows the admin email lock
 * out the real admin by deliberately failing 5 times — a denial-of-service
 * vector against the one person who needs access. Per-IP throttling slows
 * an attacker down without that risk.
 *
 * State is in-memory (resets on restart/redeploy) — acceptable for a
 * throttle, not a hard security boundary. bcrypt + the rate limiter are the
 * real defenses; this only adds friction to slow, distributed guessing.
 */
const rateLimit = require('express-rate-limit');

const loginRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many login attempts. Please wait a minute and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const MAX_BACKOFF_MS = 30 * 1000;
const failuresByIp = new Map(); // ip -> { count, lastFailAt }

function backoffDelayMs(count) {
    if (count <= 0) return 0;
    return Math.min(1000 * Math.pow(2, count - 1), MAX_BACKOFF_MS);
}

function loginBackoffGuard(req, res, next) {
    const entry = failuresByIp.get(req.ip);
    if (entry) {
        const requiredDelay = backoffDelayMs(entry.count);
        const elapsed = Date.now() - entry.lastFailAt;
        if (elapsed < requiredDelay) {
            const waitSec = Math.ceil((requiredDelay - elapsed) / 1000);
            return res.status(429).json({
                success: false,
                message: `Too many failed attempts. Please wait ${waitSec}s before trying again.`,
            });
        }
    }
    next();
}

function recordLoginFailure(req) {
    const entry = failuresByIp.get(req.ip) || { count: 0, lastFailAt: 0 };
    entry.count += 1;
    entry.lastFailAt = Date.now();
    failuresByIp.set(req.ip, entry);
}

function clearLoginFailures(req) {
    failuresByIp.delete(req.ip);
}

// Periodic cleanup so the map doesn't grow unbounded from one-off IPs.
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [ip, entry] of failuresByIp) {
        if (entry.lastFailAt < cutoff) failuresByIp.delete(ip);
    }
}, 5 * 60 * 1000).unref();

module.exports = { loginRateLimiter, loginBackoffGuard, recordLoginFailure, clearLoginFailures };
