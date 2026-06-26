/**
 * Public URL helpers for share links in emails/SMS.
 * FRONTEND_URL = Firebase Hosting (where users open live-tracker.html)
 * APP_URL      = Render backend (API + optional static fallback)
 */
function stripTrailingSlash(url) {
    return String(url || '').replace(/\/$/, '');
}

function getFrontendUrl() {
    return stripTrailingSlash(
        process.env.FRONTEND_URL
        || process.env.APP_URL
        || `http://localhost:${process.env.PORT || 3000}`
    );
}

function getBackendUrl() {
    return stripTrailingSlash(
        process.env.APP_URL
        || process.env.SERVER_URL
        || `http://localhost:${process.env.PORT || 3000}`
    );
}

function liveTrackerLink(sessionId, { code } = {}) {
    const base = getFrontendUrl();
    if (code) return `${base}/live-tracker.html?code=${encodeURIComponent(code)}`;
    return `${base}/live-tracker.html?track=${encodeURIComponent(sessionId)}`;
}

module.exports = { getFrontendUrl, getBackendUrl, liveTrackerLink };
