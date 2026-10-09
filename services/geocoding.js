'use strict';
/**
 * Reverse geocoding (lat/lng -> human-readable address) via the Google Maps
 * Geocoding API. Used to fill in SOS/emergency event locations, which were
 * previously stored as raw coordinates only — the admin panel's SOS Events
 * table reads `location.address`, which never existed, so it always showed
 * blank.
 *
 * Best-effort only: never throws. A failed/unconfigured geocode just means
 * the event is stored without an address (falls back to raw coordinates in
 * the UI), never blocks the actual SOS/alert flow.
 */

function isConfigured() {
    return !!process.env.GOOGLE_MAPS_API_KEY;
}

async function reverseGeocode(latitude, longitude) {
    if (!isConfigured() || typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.status !== 'OK' || !data.results?.length) return null;
        return data.results[0].formatted_address || null;
    } catch (err) {
        console.warn('[Geocoding] reverseGeocode failed (non-fatal):', err.message);
        return null;
    }
}

module.exports = { reverseGeocode, isConfigured };
