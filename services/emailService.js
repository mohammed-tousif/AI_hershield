'use strict';

/**
 * Email delivery via the Gmail REST API (HTTPS), NOT SMTP.
 *
 * Why this exists: Render blocks outbound SMTP entirely (confirmed by direct
 * testing — both port 465 and 587 to smtp.gmail.com time out identically from
 * Render, while both work fine from a local machine). Nodemailer's Gmail
 * "OAuth2" support still talks SMTP under the hood (XOAUTH2 is just a SASL
 * auth mechanism over the same blocked port), so it would NOT fix this.
 * The Gmail *API* (gmail.googleapis.com) is a plain HTTPS JSON API on port
 * 443, which is not blocked, so it's the only path that actually works from
 * Render while still sending as the existing Gmail account.
 *
 * Required env vars (one-time OAuth2 setup in Google Cloud Console):
 *   GMAIL_OAUTH_CLIENT_ID
 *   GMAIL_OAUTH_CLIENT_SECRET
 *   GMAIL_OAUTH_REFRESH_TOKEN   (obtained once via a manual consent flow)
 *   EMAIL_USER                  (the sending Gmail address, e.g. developerclub63@gmail.com)
 */
const { google } = require('googleapis');

let _oauth2Client = null;
let _gmail = null;

function isConfigured() {
    return !!(
        process.env.GMAIL_OAUTH_CLIENT_ID &&
        process.env.GMAIL_OAUTH_CLIENT_SECRET &&
        process.env.GMAIL_OAUTH_REFRESH_TOKEN &&
        process.env.EMAIL_USER
    );
}

function getClient() {
    if (_gmail) return _gmail;
    if (!isConfigured()) return null;

    _oauth2Client = new google.auth.OAuth2(
        process.env.GMAIL_OAUTH_CLIENT_ID,
        process.env.GMAIL_OAUTH_CLIENT_SECRET
    );
    _oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN });

    _gmail = google.gmail({ version: 'v1', auth: _oauth2Client });
    return _gmail;
}

/** UTF-8 safe header encoding for the Subject line (supports emoji/non-ASCII). */
function encodeHeader(text) {
    return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}

function toRecipientHeader(to) {
    const list = Array.isArray(to) ? to : [to];
    return list.filter(Boolean).join(', ');
}

/** Build a raw RFC 2822 message and base64url-encode it, as required by the Gmail API. */
function buildRawMessage({ from, to, subject, html }) {
    const messageParts = [
        `From: ${from}`,
        `To: ${toRecipientHeader(to)}`,
        `Subject: ${encodeHeader(subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: 7bit',
        '',
        html,
    ];
    const message = messageParts.join('\r\n');
    return Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Drop-in replacement for nodemailer's transporter.sendMail({ from, to, subject, html }).
 * Returns { success, id } on success or throws on failure (same as nodemailer).
 */
async function sendMail({ from, to, subject, html }) {
    const gmail = getClient();
    if (!gmail) {
        const err = new Error('Gmail API is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN and EMAIL_USER.');
        err.code = 'EMAIL_NOT_CONFIGURED';
        throw err;
    }

    const raw = buildRawMessage({ from: from || process.env.EMAIL_USER, to, subject, html });

    const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
    });

    return { success: true, id: result.data.id };
}

module.exports = { sendMail, isConfigured };
