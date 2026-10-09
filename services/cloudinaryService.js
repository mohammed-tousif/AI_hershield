'use strict';
/**
 * Image storage via Cloudinary — replaces Firebase Cloud Storage.
 *
 * Why this exists: Firebase Storage requires the project's Google Cloud
 * billing account to be active (Blaze plan). This project's billing account
 * went delinquent and cannot be reopened (see GMAIL_OAUTH_REFRESH_TOKEN_UPDATE.md
 * for unrelated context — this is a separate billing issue on the same GCP
 * project). Firestore, Firebase Auth, and Firebase Hosting are all separate
 * products that don't require billing and are unaffected — only image
 * upload/storage moved here.
 *
 * Two delivery types are used, matching the visibility each feature needs:
 *   - 'upload'        — publicly viewable via a plain URL (community post
 *                        images, avatars — same visibility as the old
 *                        makePublic() GCS files).
 *   - 'authenticated'  — NOT reachable via a guessable public URL; can only
 *                        be fetched server-side with a signed URL generated
 *                        using the API secret (verification selfies — same
 *                        access model as the old non-public GCS files, which
 *                        were only ever reachable through the admin route).
 *
 * Required env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const cloudinary = require('cloudinary').v2;

let configured = false;

function isConfigured() {
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

function ensureConfigured() {
    if (configured || !isConfigured()) return;
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
    });
    configured = true;
}

function notConfiguredError() {
    const err = new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
    );
    err.code = 'IMAGE_STORAGE_NOT_CONFIGURED';
    return err;
}

/**
 * Uploads a buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {object} opts
 * @param {string} opts.publicId - full public id, e.g. "community-posts/1785_123"
 *        (no file extension — Cloudinary detects format and appends it to
 *        the delivery URL automatically).
 * @param {'upload'|'authenticated'} [opts.type] - delivery type.
 * @returns {Promise<{url: string, publicId: string}>}
 */
function uploadImage(buffer, { publicId, type = 'upload' } = {}) {
    ensureConfigured();
    if (!isConfigured()) return Promise.reject(notConfiguredError());
    if (!publicId) return Promise.reject(new Error('uploadImage requires a publicId'));

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { public_id: publicId, type, resource_type: 'image', overwrite: true },
            (err, result) => {
                if (err) return reject(err);
                resolve({ url: result.secure_url, publicId: result.public_id });
            }
        );
        stream.end(buffer);
    });
}

/**
 * Deletes an image by its Cloudinary public_id. Safe to call on an
 * already-deleted / nonexistent id, or with a falsy id — resolves either
 * way instead of throwing, mirroring the .catch(() => {}) pattern used at
 * every old GCS delete call site in this codebase.
 */
async function deleteImage(publicId, { type = 'upload' } = {}) {
    if (!publicId) return { result: 'skipped' };
    ensureConfigured();
    if (!isConfigured()) return { result: 'skipped' };
    try {
        return await cloudinary.uploader.destroy(publicId, { type, resource_type: 'image' });
    } catch (err) {
        console.warn('[cloudinaryService] deleteImage failed:', err.message);
        return { result: 'error', error: err.message };
    }
}

/**
 * Downloads an 'authenticated'-type asset server-side using a freshly signed
 * URL (never exposed to the client) and returns its bytes. Used only for
 * verification selfies, streamed to the browser by the admin route.
 * Throws an Error with .code === 404 if the asset doesn't exist.
 */
async function downloadAuthenticated(publicId) {
    ensureConfigured();
    if (!isConfigured()) throw notConfiguredError();
    if (!publicId) {
        const err = new Error('downloadAuthenticated requires a publicId');
        err.code = 404;
        throw err;
    }

    const url = cloudinary.url(publicId, {
        type: 'authenticated',
        resource_type: 'image',
        sign_url: true,
    });

    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) {
        const err = new Error(`Cloudinary fetch failed with HTTP ${resp.status}`);
        err.code = resp.status === 404 ? 404 : resp.status;
        throw err;
    }
    const arrayBuffer = await resp.arrayBuffer();
    return {
        buffer: Buffer.from(arrayBuffer),
        contentType: resp.headers.get('content-type') || 'image/jpeg',
    };
}

module.exports = { isConfigured, uploadImage, deleteImage, downloadAuthenticated };
