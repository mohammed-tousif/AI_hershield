'use strict';
/**
 * services/verificationRetention.js
 * -----------------------------------
 * Automatic cleanup for gender-verification selfies (routes/verification.js).
 *
 * Selfies are only needed for the admin review window (routes/admin.js).
 * 90 days after submission we delete the image file from disk and clear
 * the pointer on the user doc, regardless of outcome (verified/rejected/
 * pending) — this minimizes how long a sensitive biometric photo sits on
 * the server. verificationStatus itself is never touched by this sweep:
 * a user who was verified stays verified after their photo is purged.
 */
const path = require('path');
const fs = require('fs');
const { usersListAll, usersSave } = require('./firestoreRepository');

const RETENTION_DAYS = 90;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'verification');

function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate(); // Firestore Timestamp
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Deletes any verification selfie older than RETENTION_DAYS and clears its
 * pointer in Firestore. Safe to call repeatedly (idempotent — already-purged
 * users have no verificationSelfiePath left to act on).
 */
async function purgeExpiredVerificationSelfies() {
    let purged = 0;
    try {
        const users = await usersListAll(5000);
        const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

        for (const user of users) {
            if (!user.verificationSelfiePath) continue;
            const submittedAt = toDate(user.verificationSubmittedAt);
            if (!submittedAt || submittedAt.getTime() > cutoffMs) continue;

            const filePath = path.join(UPLOADS_DIR, path.basename(user.verificationSelfiePath));
            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.warn(`[VerificationRetention] Failed to delete ${filePath}:`, err.message);
                }
            });

            user.verificationSelfiePath = null;
            user.updatedAt = new Date();
            await usersSave(user);
            purged++;
        }

        if (purged > 0) {
            console.log(`[VerificationRetention] Purged ${purged} selfie(s) older than ${RETENTION_DAYS} days.`);
        }
    } catch (err) {
        console.warn('[VerificationRetention] Sweep failed (non-fatal):', err.message);
    }
    return purged;
}

module.exports = { purgeExpiredVerificationSelfies, RETENTION_DAYS };
