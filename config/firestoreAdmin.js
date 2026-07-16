/**
 * Firebase Admin + Cloud Firestore for the Node backend (e.g. Render).
 * Client apps use firebase-config.js; the server uses a service account.
 *
 * Provide credentials in ONE of these ways (checked in order):
 * 1. FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS — path to the downloaded *.json key (best on Windows).
 * 2. FIREBASE_SERVICE_ACCOUNT_JSON — full JSON string (single line; common on Render).
 */
const fs = require('fs');
const path = require('path');

let firestoreAdmin = null;
let initTried = false;

function readJsonFileSafe(filePath) {
    const trimmed = filePath.trim();
    const rel = trimmed.replace(/^\.[/\\]+/, '');

    const candidates = [];
    if (path.isAbsolute(trimmed)) {
        candidates.push(trimmed);
    } else {
        candidates.push(path.join(process.cwd(), trimmed));
        candidates.push(path.join(__dirname, '..', rel));
        candidates.push(path.join(__dirname, '..', trimmed));
    }

    let resolved = null;
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            resolved = p;
            break;
        }
    }
    if (!resolved) {
        throw new Error(
            `Service account file not found. Tried: ${[...new Set(candidates)].join(' | ')}`
        );
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw);
}

function getFirestoreAdmin() {
    if (initTried) return firestoreAdmin;
    initTried = true;

    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    let cred = null;

    try {
        // Prefer a file path (reliable on Windows); then inline JSON (common on Render).
        if (filePath && filePath.trim()) {
            cred = readJsonFileSafe(filePath.trim());
        } else if (inline && inline !== 'your_firebase_service_account_json_here') {
            cred = JSON.parse(inline);
        }

        if (!cred || cred.type !== 'service_account') {
            return null;
        }

        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(cred) });
        }
        firestoreAdmin = admin.firestore();
        const src =
            filePath && filePath.trim()
                ? path.basename(filePath.trim())
                : 'FIREBASE_SERVICE_ACCOUNT_JSON';
        console.log(`🔑 Firestore Admin ready (credentials: ${src})`);
    } catch (err) {
        console.warn('⚠️  Firestore Admin init failed:', err.message);
        if (inline && !filePath) {
            console.warn(
                '   Tip: JSON in .env often breaks on Windows. Download the service account key and set FIREBASE_SERVICE_ACCOUNT_PATH=./your-key.json'
            );
        }
        firestoreAdmin = null;
    }
    return firestoreAdmin;
}

/**
 * Cloud Storage bucket for server-side file uploads (e.g. gender-verification
 * selfies — see routes/verification.js). Unlike local disk, this survives
 * Render redeploys/restarts, which wipe any ephemeral filesystem storage.
 * Returns null if Firestore Admin isn't configured or FIREBASE_STORAGE_BUCKET
 * isn't set — callers must handle that (503, not a crash).
 */
function getStorageBucket() {
    if (!getFirestoreAdmin()) return null; // ensures the admin app is initialized
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
    if (!bucketName) return null;
    try {
        const admin = require('firebase-admin');
        return admin.storage().bucket(bucketName);
    } catch (err) {
        console.warn('⚠️  Firebase Storage bucket unavailable:', err.message);
        return null;
    }
}

module.exports = { getFirestoreAdmin, getStorageBucket };
