const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const nodemailer = require('nodemailer');
const {
    usersFindById, usersSave, usersCreate,
    trackingFindById, trackingUpdate,
    liveSessionCreate, liveSessionStop,
    trackingCodeExists,
    sosCreate, sosFindActive, sosMarkSafe, sosMarkExpired, sosFindByUserId,
} = require('../services/firestoreRepository');
const smsService = require('../services/smsService');
const whatsappService = require('../services/whatsappService');

// ─── Email transporter (same Gmail config as liveTracker.js) ─────────────────
function hasEmailConfig() {
    const u = process.env.EMAIL_USER && String(process.env.EMAIL_USER).trim();
    const p = process.env.EMAIL_PASS && String(process.env.EMAIL_PASS).trim();
    return !!(u && p);
}

const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

/**
 * Send a rich HTML SOS email to a single contact email address.
 */
async function sendSosEmail({ toEmail, toName, userName, userEmail, location, trackingLink }) {
    if (!hasEmailConfig()) {
        console.warn('⚠️  Email not configured — SOS email skipped for', toEmail);
        return { success: false, mock: true, reason: 'Email not configured' };
    }
    const googleMapsLink = location
        ? `https://maps.google.com/?q=${location.latitude},${location.longitude}`
        : null;

    const html = `
    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12);">
      <div style="background:linear-gradient(135deg,#FF453A,#c0392b);color:white;padding:30px;text-align:center;">
        <h1 style="margin:0;font-size:30px;letter-spacing:2px;">🚨 SOS EMERGENCY ALERT</h1>
        <p style="margin:10px 0 0;font-size:16px;opacity:0.9;">Immediate Assistance Required</p>
      </div>
      <div style="padding:30px;background:#fff;">
        <p style="font-size:17px;color:#333;line-height:1.7;text-align:center;margin-bottom:24px;">
          <strong>${userName || 'A HerShield User'}</strong> has activated an Emergency SOS alert.<br>
          Please check on them immediately.
        </p>
        <div style="background:#fff5f5;padding:20px;border-radius:12px;border-left:5px solid #FF453A;margin-bottom:24px;">
          <h3 style="margin-top:0;color:#c0392b;font-size:17px;">📍 Alert Details</h3>
          <p style="margin:8px 0;"><strong>User:</strong> ${userName || 'Unknown'}</p>
          <p style="margin:8px 0;"><strong>Email:</strong> ${userEmail || 'Not provided'}</p>
          <p style="margin:8px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          ${location ? `<p style="margin:8px 0;"><strong>Location:</strong> ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}</p>` : ''}
        </div>
        <div style="text-align:center;margin-bottom:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          ${trackingLink ? `<a href="${trackingLink}" style="background:linear-gradient(135deg,#FF453A,#c0392b);color:white;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 15px rgba(255,69,58,0.35);">📡 Track Live Location</a>` : ''}
          ${googleMapsLink ? `<a href="${googleMapsLink}" style="background:linear-gradient(135deg,#007bff,#0056b3);color:white;padding:14px 28px;text-decoration:none;border-radius:50px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 15px rgba(0,123,255,0.3);">📍 Open in Google Maps</a>` : ''}
        </div>
        <p style="font-size:13px;color:#888;text-align:center;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          This alert was sent via the <strong>HerShield</strong> safety platform. The user's live location is being continuously shared until they confirm they are safe.
        </p>
      </div>
    </div>`;

    try {
        await emailTransporter.sendMail({
            from: `"HerShield Safety" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `🚨 URGENT: ${userName || 'A HerShield User'} needs help — SOS Alert`,
            html,
        });
        console.log(`✅ SOS email sent to ${toEmail}`);
        return { success: true, to: toEmail };
    } catch (err) {
        console.error(`❌ SOS email failed for ${toEmail}:`, err.message);
        return { success: false, to: toEmail, error: err.message };
    }
}

/**
 * Send SOS emails to all contacts that have an email address.
 */
async function sendBulkSosEmails(contacts, userName, userEmail, location, trackingLink) {
    const results = [];
    for (const c of contacts) {
        if (!c.email) continue;
        const r = await sendSosEmail({
            toEmail: c.email,
            toName: c.name,
            userName,
            userEmail,
            location,
            trackingLink,
        });
        results.push({ contactName: c.name, ...r, method: 'email' });
        await new Promise(res => setTimeout(res, 80)); // minor rate-limit guard
    }
    return results;
}

// ─── Shared in-memory SOS timer map (exported so server.js can re-hydrate) ───
const sosTimerMap = new Map(); // userId → { timeoutId, sosId }

function hashPin(pin) {
    return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

function generateTrackingCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    while (code.length < len) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

async function ensureUniqueCode() {
    let code;
    let tries = 0;
    do {
        code = generateTrackingCode();
        tries++;
    } while (tries < 10 && (await trackingCodeExists(code)));
    return code;
}

async function autoExpireSos(userId, sosId) {
    sosTimerMap.delete(userId);
    try {
        await sosMarkExpired(sosId);
        await liveSessionStop(userId);
        console.log(`⏰ SOS auto-expired for userId=${userId}`);
    } catch (e) {
        console.error('Auto-expire SOS error:', e.message);
    }
}

/** Schedule the auto-stop timer. Call on SOS start AND on server restart re-hydration. */
function scheduleSosTimer(userId, sosId, expiresAt) {
    if (!expiresAt) return;
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft <= 0) {
        autoExpireSos(userId, sosId);
        return;
    }
    const existing = sosTimerMap.get(userId);
    if (existing) clearTimeout(existing.timeoutId);
    const timeoutId = setTimeout(() => autoExpireSos(userId, sosId), msLeft);
    sosTimerMap.set(userId, { timeoutId, sosId });
}

// Export so server.js can call scheduleSosTimer on startup re-hydration
router.scheduleSosTimer = scheduleSosTimer;
router.sosTimerMap = sosTimerMap;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emergency/sos/start
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/sos/start',
    [
        body('userId').notEmpty().withMessage('userId is required'),
        body('location').isObject().withMessage('location is required'),
        body('location.latitude').isFloat().withMessage('Valid latitude required'),
        body('location.longitude').isFloat().withMessage('Valid longitude required'),
        body('pin').isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be exactly 4 digits'),
        body('timerMinutes').optional().isInt({ min: 1, max: 240 }).withMessage('timerMinutes must be 1–240'),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { userId, location, pin, timerMinutes } = req.body;

            // Auto-upsert user doc if missing
            let user = await usersFindById(userId);
            if (!user) {
                const now = new Date();
                user = {
                    _id: userId, firebaseUid: userId, email: '', name: 'HerShield User', phone: '',
                    profilePicture: `https://ui-avatars.com/api/?name=HerShield+User&background=BDA6CE&color=fff`,
                    emergencyContacts: [], safetyPreferences: { autoAlertEnabled: false, shareLocationByDefault: true, preferredAlertMethod: 'both', nightModeAutoActivate: true },
                    statistics: { totalTrips: 0, safeTrips: 0, emergencyAlerts: 0, incidentReports: 0 },
                    isActive: true, role: 'user', createdAt: now, updatedAt: now,
                };
                await usersCreate(user);
            }

            const contacts = user.emergencyContacts || [];

            // Cancel any existing active SOS for this user first
            const existingActive = await sosFindActive(userId);
            if (existingActive) {
                await sosMarkExpired(existingActive._id);
                await liveSessionStop(userId);
                const existing = sosTimerMap.get(userId);
                if (existing) { clearTimeout(existing.timeoutId); sosTimerMap.delete(userId); }
            }

            // Create live tracking session keyed to userId
            const trackingCode = await ensureUniqueCode();
            const appUrl = process.env.APP_URL || 'http://localhost:3000';
            const trackingLink = `${appUrl}/live-tracker.html?code=${trackingCode}`;

            await liveSessionCreate({
                userId,
                trackingCode,
                name: user.name || 'HerShield User',
                email: user.email || '',
                source: `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`,
                destination: '',
                transportMode: 'emergency',
                pin: hashPin(pin),
                emergencyContacts: contacts,
                isTrackingActive: true,
                lastVerified: new Date(),
                createdAt: new Date(),
            }, userId);

            // Build SOS event document
            const sosId = `sos_${userId}_${Date.now()}`;
            const triggeredAt = new Date();
            const expiresAt = timerMinutes ? new Date(triggeredAt.getTime() + timerMinutes * 60000) : null;

            await sosCreate({
                _id: sosId,
                userId,
                userName: user.name || 'HerShield User',
                userEmail: user.email || '',
                status: 'active',
                location,
                trackingCode,
                trackingLink,
                pinHash: hashPin(pin),
                timerMinutes: timerMinutes || null,
                triggeredAt,
                expiresAt,
                resolvedAt: null,
                contactCount: contacts.length,
            });

            // Update user stats
            user.statistics = user.statistics || {};
            user.statistics.emergencyAlerts = (user.statistics.emergencyAlerts || 0) + 1;
            await usersSave(user);

            // Schedule auto-expiry timer if set
            if (expiresAt) scheduleSosTimer(userId, sosId, expiresAt);

            // ── Notify emergency contacts ────────────────────────────────────
            const alertResults = [];
            const userName = user.name || 'HerShield User';

            if (contacts.length > 0) {
                const method = user.safetyPreferences?.preferredAlertMethod || 'both';
                const sorted = [...contacts].sort((a, b) => (b.priority || 1) - (a.priority || 1));

                if (method === 'sms' || method === 'both') {
                    const smsRes = await smsService.sendBulkEmergencyAlerts(sorted, userName, location, trackingLink);
                    alertResults.push(...smsRes.map(r => ({ ...r, method: 'sms' })));
                }
                if (method === 'whatsapp' || method === 'both') {
                    const waRes = await whatsappService.sendBulkEmergencyAlerts(sorted, userName, location, trackingLink);
                    alertResults.push(...waRes.map(r => ({ ...r, method: 'whatsapp' })));
                }
                // Always send email to contacts that have an email address
                const emailRes = await sendBulkSosEmails(sorted, userName, user.email || '', location, trackingLink);
                alertResults.push(...emailRes);
            }

            // ── Also notify the user themselves via SMS ──────────────────────
            const userPhone = (user.phone || '').trim();
            if (userPhone) {
                try {
                    const selfSms = await smsService.sendSosConfirmationToUser({
                        to:           userPhone,
                        userName,
                        trackingCode,
                        trackingLink,
                        timerMinutes: timerMinutes || null,
                    });
                    alertResults.push({ contactName: 'You (self)', method: 'sms_self', ...selfSms });
                    if (selfSms.success) {
                        console.log(`✅ SOS self-SMS sent to user ${userId} at ${userPhone}`);
                    } else {
                        console.warn(`⚠️  SOS self-SMS failed for ${userId}:`, selfSms.error);
                    }
                } catch (smsErr) {
                    console.error('Self-SMS error (non-fatal):', smsErr.message);
                }
            } else {
                console.log(`ℹ️  SOS self-SMS skipped — user ${userId} has no phone on file`);
            }

            return res.status(201).json({
                success: true,
                message: contacts.length > 0
                    ? `SOS activated. Alerts sent to ${contacts.length} contact(s).`
                    : 'SOS activated. No emergency contacts configured — add contacts in your profile.',
                sosId,
                trackingCode,
                trackingLink,
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
                contactCount: contacts.length,
                alertResults,
            });
        } catch (err) {
            console.error('SOS start error:', err);
            return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to start SOS' });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emergency/sos/safe  — mark user safe (requires PIN)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/sos/safe',
    [
        body('userId').notEmpty(),
        body('pin').isLength({ min: 4, max: 4 }).isNumeric().withMessage('PIN must be 4 digits'),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { userId, pin } = req.body;
            const sosSession = await sosFindActive(userId);
            if (!sosSession) {
                return res.status(404).json({ error: 'No active SOS session found for this user' });
            }

            // Verify PIN
            if (hashPin(pin) !== sosSession.pinHash) {
                return res.status(401).json({ error: 'Incorrect PIN. Location sharing continues.' });
            }

            // Clear timer
            const timer = sosTimerMap.get(userId);
            if (timer) { clearTimeout(timer.timeoutId); sosTimerMap.delete(userId); }

            await sosMarkSafe(sosSession._id, new Date());
            await liveSessionStop(userId);

            // ── Send "safe" SMS to user + all contacts ───────────────────────
            const safeResults = [];
            try {
                const user = await usersFindById(userId);
                const safeName = user?.name || 'HerShield User';
                const contacts = user?.emergencyContacts || [];

                // Notify user themselves
                const userPhone = (user?.phone || '').trim();
                if (userPhone) {
                    const r = await smsService.sendSafeConfirmation({ to: userPhone, userName: safeName });
                    safeResults.push({ to: 'self', ...r });
                    console.log(r.success ? `✅ Safe SMS → user (${userPhone})` : `⚠️  Safe SMS failed → user`);
                }

                // Notify each contact
                const contactSafeRes = await smsService.sendBulkSafeConfirmations(contacts, safeName);
                safeResults.push(...contactSafeRes);

                const emailSafeSent = contacts.filter(c => c.email).length;
                if (emailSafeSent > 0) {
                    // Re-use sendBulkSosEmails with a "safe" subject override isn't available,
                    // so skip email here — safe status is self-evident from the cease of alerts.
                    console.log(`ℹ️  Safe email not sent (contacts already received SOS email)`);
                }
            } catch (safeNotifyErr) {
                console.error('Safe notification error (non-fatal):', safeNotifyErr.message);
            }

            return res.json({
                success: true,
                message: "You're marked safe. Location sharing has stopped.",
                safeNotifications: safeResults,
            });
        } catch (err) {
            console.error('SOS safe error:', err);
            return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark safe' });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emergency/sos/active/:userId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sos/active/:userId', async (req, res) => {
    try {
        const session = await sosFindActive(req.params.userId);
        if (!session) return res.json({ active: false });
        return res.json({
            active: true,
            sosId: session._id,
            trackingCode: session.trackingCode,
            trackingLink: session.trackingLink,
            triggeredAt: session.triggeredAt,
            expiresAt: session.expiresAt,
            timerMinutes: session.timerMinutes,
            contactCount: session.contactCount,
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emergency/sos/history/:userId  — user's own SOS history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sos/history/:userId', async (req, res) => {
    try {
        const history = await sosFindByUserId(req.params.userId, 20);
        return res.json({ success: true, history });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Existing endpoints below
// ─────────────────────────────────────────────────────────────────────────────

router.post(
    '/trigger',
    [
        body('userId').notEmpty().withMessage('User ID is required'),
        body('location').isObject().withMessage('Location is required'),
        body('location.latitude').isFloat().withMessage('Valid latitude required'),
        body('location.longitude').isFloat().withMessage('Valid longitude required'),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { userId, location, sessionId } = req.body;
            const user = await usersFindById(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });

            const contacts = user.emergencyContacts || [];
            if (!contacts.length) {
                return res.status(400).json({
                    error: 'No emergency contacts configured',
                    message: 'Please add emergency contacts in your profile',
                });
            }

            let trackingLink = null;
            if (sessionId) {
                const session = await trackingFindById(sessionId);
                if (session) {
                    trackingLink = `${process.env.APP_URL || 'http://localhost:3000'}/live-tracker.html?code=${session.trackingCode}`;
                    session.emergencyAlerts = session.emergencyAlerts || [];
                    session.emergencyAlerts.push({ location, notificationsSent: [], timestamp: new Date() });
                    await trackingUpdate(session);
                }
            }

            const method = user.safetyPreferences?.preferredAlertMethod || 'both';
            const sorted = contacts.sort((a, b) => (b.priority || 1) - (a.priority || 1));
            const results = [];

            if (method === 'sms' || method === 'both') {
                const sms = await smsService.sendBulkEmergencyAlerts(sorted, user.name, location, trackingLink);
                results.push(...sms.map((r) => ({ ...r, method: 'sms' })));
            }
            if (method === 'whatsapp' || method === 'both') {
                const wa = await whatsappService.sendBulkEmergencyAlerts(sorted, user.name, location, trackingLink);
                results.push(...wa.map((r) => ({ ...r, method: 'whatsapp' })));
            }

            user.statistics = user.statistics || {};
            user.statistics.emergencyAlerts = (user.statistics.emergencyAlerts || 0) + 1;
            await usersSave(user);

            return res.json({
                success: true,
                message: 'Emergency alerts sent successfully',
                alertsSent: results.filter((r) => r.success).length,
                totalContacts: sorted.length,
                results,
                trackingLink,
            });
        } catch (error) {
            console.error('emergency/trigger:', error);
            const status = error.statusCode || 500;
            return res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to trigger emergency',
            });
        }
    }
);

router.post(
    '/contacts',
    [
        body('userId').notEmpty(),
        body('name').notEmpty().trim(),
        body('phone').optional().trim(),
        body('email').optional().isEmail().withMessage('Invalid contact email format'),
        body('relationship').optional().trim(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { userId, name, phone, email, relationship, priority } = req.body;

            if (!name || (!phone && !email)) {
                return res.status(400).json({
                    error: 'Contact name and at least one of phone or email is required',
                });
            }

            let user = await usersFindById(userId);
            if (!user) {
                const now = new Date();
                user = {
                    _id: userId, firebaseUid: userId, email: '', name: 'Her Shield User', phone: '',
                    profilePicture: `https://ui-avatars.com/api/?name=HerShield+User&background=BDA6CE&color=fff`,
                    emergencyContacts: [],
                    safetyPreferences: { autoAlertEnabled: false, shareLocationByDefault: true, preferredAlertMethod: 'both', nightModeAutoActivate: true },
                    statistics: { totalTrips: 0, safeTrips: 0, emergencyAlerts: 0, incidentReports: 0 },
                    isActive: true, role: 'user', createdAt: now, updatedAt: now,
                };
                await usersCreate(user);
                console.log('Auto-created user stub for:', userId);
            }

            const formatted = phone ? smsService.formatPhoneNumber(phone) : null;
            const phoneValid = formatted ? smsService.validatePhoneNumber(formatted) : false;

            user.emergencyContacts = user.emergencyContacts || [];
            user.emergencyContacts.push({
                _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                name,
                phone: phoneValid ? formatted : (phone || null),
                phoneValid,
                email: email || null,
                relationship: relationship || 'Emergency Contact',
                priority: priority || 1,
                addedAt: new Date().toISOString(),
            });
            await usersSave(user);
            return res.json({ success: true, message: 'Emergency contact added successfully', contacts: user.emergencyContacts });
        } catch (error) {
            const status = error.statusCode || 500;
            return res.status(status).json({ error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to add contact' });
        }
    }
);

router.get('/contacts/:userId', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        return res.json({ success: true, contacts: (user && user.emergencyContacts) || [] });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({ error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to load contacts' });
    }
});

router.delete('/contacts/:userId/:contactId', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        if (!user) return res.json({ success: true, contacts: [] });
        user.emergencyContacts = (user.emergencyContacts || []).filter((c) => c._id !== req.params.contactId);
        await usersSave(user);
        return res.json({ success: true, message: 'Emergency contact removed successfully', contacts: user.emergencyContacts });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({ error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to remove contact' });
    }
});

router.post('/send-location', [body('userId').notEmpty(), body('location').isObject()], async (req, res) => {
    try {
        const { userId, location, message } = req.body;
        const user = await usersFindById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const results = [];
        for (const contact of user.emergencyContacts || []) {
            const sms = await smsService.sendLocationUpdate({ to: contact.phone, userName: user.name, location, message });
            results.push({ contactName: contact.name, ...sms });
        }
        return res.json({ success: true, message: 'Location shared with emergency contacts', results });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({ error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to send location' });
    }
});

module.exports = router;
