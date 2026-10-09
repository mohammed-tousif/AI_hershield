'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const CODE_LIFETIME = 5 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const HOUR = 60 * 60 * 1000;
function failure(status, message, retryAfter = 0) {
    return { status, body: { success: false, message, ...(retryAfter ? { retryAfter } : {}) } };
}
const success = body => ({ status: 200, body: { success: true, ...body } });
const remaining = (until, now) => Math.max(0, Math.ceil((until - now) / 1000));

// A separate, server-only record binds verification to BOTH the UID and email.
// Never copy a client-supplied verified flag into a profile or Firebase Auth.
function createEmailVerificationService({ db, auth, mailer, now = Date.now }) {
    const recordRef = uid => db.collection('emailVerification').doc(uid);
    async function identity(identity) {
        const user = await auth.getUser(identity.uid);
        if (user.disabled) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
        if (!user.email || /[\r\n]/.test(user.email)) throw Object.assign(new Error('This account needs an email address before it can be verified.'), { status: 400 });
        if (user.email !== identity.email) throw Object.assign(new Error('Your email has changed. Please sign in again.'), { status: 409 });
        return user;
    }
    const isVerified = (user, data) => user.emailVerified === true || data?.verifiedEmail === user.email;
    async function status(identityInput) {
        const user = await identity(identityInput);
        const data = (await recordRef(user.uid).get()).data() || {};
        return success({ email: user.email, verified: isVerified(user, data),
            retryAfter: remaining((data.lastSentAt || 0) + COOLDOWN, now()),
            expiresIn: data.state === 'sent' ? remaining(data.expiresAt, now()) : 0 });
    }
    async function send(identityInput) {
        const user = await identity(identityInput);
        if (!mailer.isConfigured()) return failure(503, 'Email delivery is unavailable. Please try again later.');
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const codeHash = await bcrypt.hash(code, 12);
        const challengeId = crypto.randomBytes(16).toString('hex');
        const ref = recordRef(user.uid);
        const addressRef = db.collection('emailVerificationLimits').doc(crypto.createHash('sha256').update(user.email.toLowerCase()).digest('hex'));
        const reserved = await db.runTransaction(async tx => {
            const data = (await tx.get(ref)).data() || {};
            const address = (await tx.get(addressRef)).data() || {};
            if (isVerified(user, data)) return success({ verified: true, email: user.email });
            const time = now();
            const wait = remaining((data.lastSentAt || 0) + COOLDOWN, time);
            if (wait) return failure(429, 'Please wait before requesting another code.', wait);
            const accountWindow = time < (data.windowStart || 0) + HOUR;
            const addressWindow = time < (address.windowStart || 0) + HOUR;
            if (accountWindow && data.checks >= 10) return failure(429, 'Too many verification attempts. Please try again later.', remaining(data.windowStart + HOUR, time));
            if ((accountWindow && data.sends >= 5) || (addressWindow && address.sends >= 5)) {
                return failure(429, 'Too many email requests. Please try again later.', remaining(Math.max(accountWindow ? data.windowStart + HOUR : 0, addressWindow ? address.windowStart + HOUR : 0), time));
            }
            tx.set(ref, { ...data, email: user.email, challengeId, codeHash, state: 'sending',
                lastSentAt: time, expiresAt: time + CODE_LIFETIME, attempts: 0,
                windowStart: accountWindow ? data.windowStart : time,
                sends: accountWindow ? (data.sends || 0) + 1 : 1,
                checks: accountWindow ? (data.checks || 0) : 0 });
            tx.set(addressRef, { windowStart: addressWindow ? address.windowStart : time,
                sends: addressWindow ? (address.sends || 0) + 1 : 1,
                deleteAfter: new Date(time + 2 * HOUR) });
            return null;
        });
        if (reserved) return reserved;
        let delivered = false;
        try {
            const result = await mailer.sendMail({ to: user.email, subject: 'Your HerShield email verification code',
                html: `<div style="font-family:Arial,sans-serif;color:#302b29;max-width:480px;margin:auto;padding:28px;background:#fff8f2"><h1 style="font-size:24px">Verify your email</h1><p>Enter this code in HerShield:</p><p style="font-size:34px;letter-spacing:8px;font-weight:bold">${code}</p><p>This code expires in 5 minutes and can be used once. Do not share it with anyone.</p><p>If you did not request this code, you can ignore this email.</p></div>` });
            delivered = result?.success === true;
        } catch { /* Provider details and OTPs must never be logged or returned. */ }
        const active = await db.runTransaction(async tx => {
            const data = (await tx.get(ref)).data();
            if (!data || data.challengeId !== challengeId || isVerified(user, data)) return false;
            tx.set(ref, { ...data, state: delivered ? 'sent' : 'failed', codeHash: delivered ? codeHash : null });
            return true;
        });
        if (!active) return failure(409, 'A newer request replaced this code. Use the latest code or refresh your verification status.');
        return delivered ? success({ email: user.email, verified: false, expiresIn: CODE_LIFETIME / 1000, retryAfter: COOLDOWN / 1000 })
            : failure(503, 'We could not confirm email delivery. Wait a minute and request a new code.', COOLDOWN / 1000);
    }
    async function verify(identityInput, code) {
        if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return failure(400, 'Enter the six-digit code from your email.');
        const user = await identity(identityInput);
        const ref = recordRef(user.uid);
        return db.runTransaction(async tx => {
            const data = (await tx.get(ref)).data() || {};
            if (isVerified(user, data)) return success({ email: user.email, verified: true });
            const time = now();
            if (data.email !== user.email || data.state !== 'sent' || !data.codeHash || time >= data.expiresAt) {
                return failure(400, 'This code has expired or is unavailable. Request a new code.');
            }
            const checks = time < data.windowStart + HOUR ? (data.checks || 0) : 0;
            if (data.attempts >= 5 || checks >= 10) return failure(429, 'Too many incorrect attempts. Please try again later.', remaining(data.windowStart + HOUR, time));
            const matches = await bcrypt.compare(code, data.codeHash);
            const updated = { ...data, attempts: data.attempts + 1, checks: checks + 1 };
            if (matches) {
                // Consuming the challenge and marking the bound email verified is ONE atomic write.
                tx.set(ref, { ...updated, state: 'verified', codeHash: null, verifiedEmail: user.email, verifiedAt: time });
                return success({ email: user.email, verified: true });
            }
            tx.set(ref, updated); // Return rather than throw: failed-attempt counters must commit.
            return failure(400, 'That code is incorrect. Check your email and try again.');
        });
    }
    return { status, send, verify };
}
module.exports = { createEmailVerificationService };
