'use strict';

/**
 * HerShield — Production SMS Service (Twilio)
 * ─────────────────────────────────────────────
 * Handles all SMS delivery for emergency alerts, safe confirmations,
 * location shares, and check-ins.
 *
 * Key behaviours:
 *  • Validates & normalises every phone number to E.164 before sending.
 *  • Skips contacts with missing / invalid phones (never throws).
 *  • Retries once on transient Twilio errors (rate-limit / timeout).
 *  • Categorises errors (invalid_number, unverified, auth, network, unknown).
 *  • Exposes a testSend() method for the admin test-SMS endpoint.
 */

const path   = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ── Twilio init ─────────────────────────────────────────────────────────────
const ACCOUNT_SID  = (process.env.TWILIO_ACCOUNT_SID  || '').trim();
const AUTH_TOKEN   = (process.env.TWILIO_AUTH_TOKEN   || '').trim();
const FROM_NUMBER  = (process.env.TWILIO_PHONE_NUMBER || '').trim();

const CONFIGURED = !!(
    ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER &&
    ACCOUNT_SID !== 'your_twilio_account_sid_here'
);

let twilioClient = null;
if (CONFIGURED) {
    try {
        twilioClient = require('twilio')(ACCOUNT_SID, AUTH_TOKEN);
        console.log('✅ Twilio SMS Service initialized');
    } catch (e) {
        console.error('❌ Twilio init failed:', e.message);
    }
} else {
    console.warn('⚠️  Twilio credentials not configured — SMS running in mock mode');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise a phone number to E.164.
 * Strips spaces, dashes, parentheses, dots.
 * Assumes +91 (India) if no country code present.
 */
function formatE164(phone) {
    if (!phone) return null;
    let p = String(phone).replace(/[\s\-().]/g, '');
    if (!p.startsWith('+')) {
        // Strip leading 0 (trunk prefix) before adding country code
        if (p.startsWith('0')) p = p.slice(1);
        p = '+91' + p;                // default to India
    }
    return p;
}

/** Basic E.164 regex — ITU-T max 15 digits after '+'. */
function isValidE164(phone) {
    return /^\+[1-9]\d{6,14}$/.test(phone);
}

/** Map a Twilio error code to a friendly category string. */
function categoriseError(err) {
    const code = err.code || 0;
    const msg  = (err.message || '').toLowerCase();
    if ([21211, 21614, 21217, 21401].includes(code)) return 'invalid_number';
    if ([21612, 21408, 21215].includes(code)) return 'unverified_destination';
    if ([20003, 20005].includes(code)) return 'auth_error';
    if (code === 30044) return 'trial_msg_too_long';
    if (code >= 30001 && code <= 30009)            return 'delivery_failed';
    if (msg.includes('timeout') || msg.includes('ECONNRESET')) return 'network_error';
    return 'unknown';
}

/** Sleep helper for retry back-off. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Core send (with one retry) ──────────────────────────────────────────────

async function _sendOne(to, body, attempt = 1) {
    try {
        const msg = await twilioClient.messages.create({ body, from: FROM_NUMBER, to });
        console.log(`✅ SMS sent → ${to} [${msg.sid}] status=${msg.status}`);
        return { success: true, sid: msg.sid, status: msg.status, to };
    } catch (err) {
        const category = categoriseError(err);
        console.error(`❌ SMS failed → ${to} | attempt=${attempt} | category=${category} | ${err.message}`);

        // Retry once on network/rate-limit errors
        if (attempt === 1 && ['network_error'].includes(category)) {
            await sleep(1200);
            return _sendOne(to, body, 2);
        }

        return {
            success: false,
            to,
            category,
            error: err.message,
            twilioCode: err.code || null,
            hint: category === 'unverified_destination'
                ? 'Trial accounts can only send to verified numbers. Verify the number in your Twilio Console → Verified Caller IDs.'
                : undefined,
        };
    }
}

// ── Message Templates (kept under 160 chars for trial account compatibility) ─

function buildEmergencyMsg(userName, location, trackingLink) {
    const name = (userName || 'User').slice(0, 20);
    const loc  = location
        ? `maps.google.com/?q=${location.latitude},${location.longitude}`
        : 'unknown';
    // Keep under 160 chars
    if (trackingLink) {
        return `HerShield SOS: ${name} needs help! Location: ${loc} | Track: ${trackingLink}`;
    }
    return `HerShield SOS ALERT: ${name} triggered emergency! Location: ${loc}`;
}

function buildSafeMsg(userName) {
    const name = (userName || 'User').slice(0, 20);
    return `HerShield: ${name} is SAFE now. Emergency tracking stopped. No action needed.`;
}

function buildLocationMsg(userName, location, customMessage) {
    const name = (userName || 'User').slice(0, 20);
    const loc  = `maps.google.com/?q=${location.latitude},${location.longitude}`;
    return `HerShield: ${name} shared location - ${loc}`;
}

function buildCheckInMsg(userName, location) {
    const name = (userName || 'User').slice(0, 20);
    const loc  = `maps.google.com/?q=${location.latitude},${location.longitude}`;
    return `HerShield: ${name} checked in safely. Location: ${loc}`;
}

function buildUserSosConfirmMsg(trackingCode, trackingLink, timerMinutes) {
    const code = trackingCode ? ` Code:${trackingCode}` : '';
    const time = timerMinutes ? ` Expires:${timerMinutes}min` : '';
    return `HerShield SOS active. Contacts notified.${code}${time} Enter PIN to cancel.`;
}

// ── Public API ───────────────────────────────────────────────────────────────

class SMSService {
    get isConfigured() { return CONFIGURED && !!twilioClient; }

    /**
     * Validate & format a phone number string.
     * @returns {{ valid: boolean, e164: string|null }}
     */
    validate(phone) {
        const e164 = formatE164(phone);
        return { valid: isValidE164(e164), e164 };
    }

    /** Legacy helpers kept for backward compatibility. */
    validatePhoneNumber(phone) { return isValidE164(formatE164(phone)); }
    formatPhoneNumber(phone)   { return formatE164(phone) || phone; }

    // ── Single sends ─────────────────────────────────────────────────────────

    async sendEmergencyAlert({ to, userName, location, trackingLink }) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            console.warn(`⚠️  SMS skipped — invalid phone: "${to}"`);
            return { success: false, to, category: 'invalid_number', error: 'Invalid or missing phone number' };
        }
        const body = buildEmergencyMsg(userName, location, trackingLink);
        if (!this.isConfigured) {
            console.log(`📱 [MOCK SMS] Emergency → ${e164}\n${body}`);
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164 };
        }
        return _sendOne(e164, body);
    }

    async sendSafeConfirmation({ to, userName }) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            return { success: false, to, category: 'invalid_number', error: 'Invalid or missing phone number' };
        }
        const body = buildSafeMsg(userName);
        if (!this.isConfigured) {
            console.log(`📱 [MOCK SMS] Safe confirmation → ${e164}`);
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164 };
        }
        return _sendOne(e164, body);
    }

    async sendSosConfirmationToUser({ to, userName, trackingCode, trackingLink, timerMinutes }) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            return { success: false, to, category: 'invalid_number', error: 'Invalid or missing phone number' };
        }
        const body = buildUserSosConfirmMsg(trackingCode, trackingLink, timerMinutes);
        if (!this.isConfigured) {
            console.log(`📱 [MOCK SMS] SOS confirmation to user → ${e164}`);
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164 };
        }
        return _sendOne(e164, body);
    }

    async sendLocationUpdate({ to, userName, location, message }) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            return { success: false, to, category: 'invalid_number', error: 'Invalid or missing phone number' };
        }
        const body = buildLocationMsg(userName, location, message);
        if (!this.isConfigured) {
            console.log(`📱 [MOCK SMS] Location → ${e164}`);
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164 };
        }
        return _sendOne(e164, body);
    }

    async sendCheckInNotification({ to, userName, location }) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            return { success: false, to, category: 'invalid_number', error: 'Invalid or missing phone number' };
        }
        const body = buildCheckInMsg(userName, location);
        if (!this.isConfigured) {
            console.log(`📱 [MOCK SMS] Check-in → ${e164}`);
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164 };
        }
        return _sendOne(e164, body);
    }

    // ── Bulk sends ───────────────────────────────────────────────────────────

    /**
     * Send emergency SMS to all contacts that have a phone number.
     * Contacts without a phone are silently skipped (not counted as failures).
     */
    async sendBulkEmergencyAlerts(contacts, userName, location, trackingLink) {
        const results = [];
        for (const contact of contacts) {
            if (!contact.phone) {
                console.log(`ℹ️  SMS skipped for "${contact.name}" — no phone number`);
                continue;
            }
            const result = await this.sendEmergencyAlert({
                to: contact.phone,
                userName,
                location,
                trackingLink,
            });
            results.push({ contactName: contact.name, contactPhone: contact.phone, ...result });
            // 200ms inter-message gap to stay within Twilio rate limits
            await sleep(200);
        }
        return results;
    }

    /**
     * Send "safe" confirmation SMS to all contacts.
     */
    async sendBulkSafeConfirmations(contacts, userName) {
        const results = [];
        for (const contact of contacts) {
            if (!contact.phone) continue;
            const result = await this.sendSafeConfirmation({ to: contact.phone, userName });
            results.push({ contactName: contact.name, ...result });
            await sleep(200);
        }
        return results;
    }

    // ── Admin test send ──────────────────────────────────────────────────────

    /**
     * Send a test SMS to a specified number (admin use only).
     * @param {string} to  - Target phone number
     * @returns {object}   - Result object
     */
    async testSend(to) {
        const e164 = formatE164(to);
        if (!e164 || !isValidE164(e164)) {
            return { success: false, to, category: 'invalid_number', error: `"${to}" is not a valid phone number` };
        }
        const body = `HerShield SMS Test OK. Twilio is working correctly. Sent at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        if (!this.isConfigured) {
            return { success: true, mock: true, sid: `MOCK_${Date.now()}`, to: e164, message: body };
        }
        return _sendOne(e164, body);
    }

    /** Return current config status (no secrets exposed). */
    status() {
        return {
            configured: this.isConfigured,
            mock:        !this.isConfigured,
            fromNumber:  CONFIGURED ? FROM_NUMBER : null,
            accountSid:  CONFIGURED ? ACCOUNT_SID.slice(0, 8) + '…' : null,
        };
    }
}

module.exports = new SMSService();
