const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const router = express.Router();
const {
    liveSessionCreate,
    liveSessionGetByUserId,
    liveSessionFindByCode,
    liveSessionSetVerified,
    liveSessionPushLocation,
    liveSessionStop,
    liveSessionsByEmail,
    communityInsert,
    usersFindById,
    sosCreate,
} = require('../services/firestoreRepository');

const smsService = require('../services/smsService');
const emailService = require('../services/emailService');
const { getFrontendUrl, liveTrackerLink } = require('../config/appUrls');

// Sends via the Gmail REST API (HTTPS) instead of SMTP — see services/emailService.js
// for why: Render blocks outbound SMTP entirely, on any port.
function hasEmailConfig() {
    return emailService.isConfigured();
}
const transporter = { sendMail: (opts) => emailService.sendMail(opts) };

router.post('/start', async (req, res) => {
    try {
        const { name, source, destination, pin, emergencyContacts, transportMode, email, startLat, startLng, baseUrl } = req.body;

        const userEmail = email || process.env.EMAIL_USER;
        const userId    = Date.now().toString() + Math.floor(Math.random() * 1000);
        const trackingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        // ── Tracking link — FRONTEND_URL so emergency contacts open Firebase-hosted page
        const origin = req.body.baseUrl || getFrontendUrl();
        const trackingLink = liveTrackerLink(userId);

        // ── Map link using real GPS coords if provided ────────────────────
        const mapLink = (startLat && startLng)
            ? `https://maps.google.com/?q=${startLat},${startLng}`
            : null;

        const newSession = {
            userId, trackingCode, name,
            email: userEmail,
            source, destination,
            transportMode: transportMode || 'Not Specified',
            pin,
            emergencyContacts,
            trackingLink,
            isTrackingActive: true,
            lastVerified: new Date(),
            locationLogs: [],
            createdAt: new Date(),
        };

        await liveSessionCreate(newSession, userId);

        // ── Email all emergency contacts ──────────────────────────────────
        if (hasEmailConfig() && Array.isArray(emergencyContacts) && emergencyContacts.length > 0) {
            const html = `
            <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
              <div style="background:linear-gradient(135deg,#9B8EC7,#7A6B99);color:white;padding:28px;text-align:center;">
                <h1 style="margin:0;font-size:26px;letter-spacing:1px;">📡 Live Tracking Started</h1>
                <p style="margin:8px 0 0;opacity:0.9;font-size:15px;">Safety alert from HerShield</p>
              </div>
              <div style="padding:28px;background:#fff;">
                <p style="font-size:16px;color:#333;line-height:1.7;text-align:center;margin-bottom:22px;">
                  <strong>${name || 'A HerShield User'}</strong> has started a live tracking session and shared it with you.
                  Please keep an eye on their journey.
                </p>
                <div style="background:#f8f5ff;padding:18px;border-radius:12px;border-left:5px solid #9B8EC7;margin-bottom:22px;">
                  <h3 style="margin-top:0;color:#7A6B99;font-size:16px;">🗺️ Journey Details</h3>
                  <p style="margin:7px 0;"><strong>📍 From:</strong> ${source || 'Not specified'}</p>
                  <p style="margin:7px 0;"><strong>🏁 To:</strong> ${destination || 'Not specified'}</p>
                  <p style="margin:7px 0;"><strong>🚗 Mode:</strong> ${transportMode || 'Not specified'}</p>
                  <p style="margin:7px 0;"><strong>🕒 Started:</strong> ${new Date().toLocaleString()}</p>
                </div>
                <div style="text-align:center;margin-bottom:18px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
                  <a href="${trackingLink}" style="background:linear-gradient(135deg,#9B8EC7,#7A6B99);color:white;padding:13px 26px;text-decoration:none;border-radius:50px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 14px rgba(155,142,199,0.4);">📡 Track Live Location</a>
                  ${mapLink ? `<a href="${mapLink}" style="background:linear-gradient(135deg,#007bff,#0056b3);color:white;padding:13px 26px;text-decoration:none;border-radius:50px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 14px rgba(0,123,255,0.3);">📍 Open in Maps</a>` : ''}
                </div>
                <p style="font-size:13px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:16px;margin-top:16px;">
                  You received this because <strong>${name || 'this user'}</strong> added you as an emergency contact on <strong>HerShield</strong>.<br>
                  If they are in danger, please contact them or local authorities immediately.
                </p>
              </div>
            </div>`;

            // Send emails and wait so we know delivery status
            try {
                await transporter.sendMail({
                    from: `"HerShield Safety" <${process.env.EMAIL_USER}>`,
                    to: emergencyContacts,
                    subject: `📡 ${name || 'A HerShield User'} started Live Tracking – Stay Alert`,
                    html,
                });
                console.log(`✅ Tracking start email sent to: ${emergencyContacts.join(', ')}`);
            } catch (mailErr) {
                console.error('⚠️  Tracking start email failed:', mailErr.message);
            }
        }

        res.status(201).json({
            success: true,
            message: 'Tracking started',
            sessionId: userId,
            trackingLink,
            verifyInterval: parseInt(process.env.VERIFY_INTERVAL, 10) || 120000,
            pinTimeout:     parseInt(process.env.PIN_TIMEOUT, 10)     || 20000,
        });
    } catch (error) {
        console.error('Error starting tracking:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Server error',
        });
    }
});

router.post('/update-location', async (req, res) => {
    try {
        const { userId, lat, lng, accuracy } = req.body;

        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (!session.isTrackingActive) {
            return res.status(400).json({ success: false, message: 'Tracking is not active' });
        }

        await liveSessionPushLocation(userId, lat, lng);

        // ── Broadcast to all viewer sockets in this session room ──────────────
        const io = req.app.get('io');
        if (io) {
            io.to(userId).emit('locationUpdated', {
                location: { lat, lng, accuracy: accuracy || 50 },
                timestamp: new Date(),
            });
        }

        res.json({ success: true, message: 'Location updated' });
    } catch (error) {
        console.error('Error updating location:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Server error',
        });
    }
});

// ── GET /location/:userId — viewer polling fallback ────────────────────────────
// Returns the most recent lat/lng from the Firestore locationLogs array.
router.get('/location/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        const logs = session.locationLogs || [];
        if (logs.length === 0) {
            return res.json({ success: true, message: 'No location yet' });
        }
        const last = logs[logs.length - 1];
        return res.json({
            success: true,
            lat: last.lat,
            lng: last.lng,
            accuracy: last.accuracy || 50,
            timestamp: last.timestamp || session.lastVerified,
        });
    } catch (error) {
        console.error('Error fetching latest location:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/verify-pin', async (req, res) => {
    try {
        const { userId, pin } = req.body;

        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (session.pin !== pin) {
            return res.status(401).json({ success: false, message: 'Incorrect PIN' });
        }

        await liveSessionSetVerified(userId);

        res.json({ success: true, message: 'PIN verified' });
    } catch (error) {
        console.error('Error verifying PIN:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Server error',
        });
    }
});

router.post('/trigger-alert', async (req, res) => {
    try {
        const { userId } = req.body;

        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        const logs = session.locationLogs || [];
        const lastLocation = logs.length > 0 ? logs[logs.length - 1] : null;

        const mapLink = lastLocation
            ? `https://maps.google.com/?q=${lastLocation.lat},${lastLocation.lng}`
            : 'Location not available';

        if (!hasEmailConfig()) {
            return res.status(503).json({
                success: false,
                message:
                    'Email is not configured. Set EMAIL_USER and EMAIL_PASS in .env (Gmail app password) to send emergency alerts.',
            });
        }

        const mailOptions = {
            from: `"HerShield Safety" <${process.env.EMAIL_USER}>`,
            to: session.emergencyContacts,
            subject: `🚨 EMERGENCY ALERT: ${session.name} needs help!`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
                    <div style="background-color: #9B8EC7; color: white; padding: 20px; text-align: center;">
                        <h1 style="margin: 0; font-size: 24px;">🚨 EMERGENCY ALERT</h1>
                        <p style="margin: 10px 0 0;">Immediate Action Required</p>
                    </div>
                    
                    <div style="padding: 20px; background-color: #fff;">
                        <p style="font-size: 16px; color: #333;">
                            <strong>${session.name}</strong> has triggered an emergency alert or failed to verify their safety status.
                        </p>
                        
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <h3 style="margin-top: 0; color: #9B8EC7;">Trip Details</h3>
                            <p><strong>📍 Source:</strong> ${session.source}</p>
                            <p><strong>🏁 Destination:</strong> ${session.destination}</p>
                            <p><strong>🚗 Transport Mode:</strong> ${session.transportMode}</p>
                            <p><strong>🕒 Time:</strong> ${new Date().toLocaleString()}</p>
                        </div>

                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${mapLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 16px;">
                                View Live Location on Map
                            </a>
                        </div>
                        
                        <p style="font-size: 14px; color: #666; text-align: center;">
                            Please contact the user or local authorities immediately.
                        </p>
                    </div>
                    
                    <div style="background-color: #f1f1f1; padding: 10px; text-align: center; font-size: 12px; color: #888;">
                        Sent via Her Shield Safety Tracker
                    </div>
                </div>
            `,
        };

        // Await the send so the response honestly reflects whether the email
        // actually went out — previously this fired-and-forgot, so the client
        // always saw "success" even when the send later failed in the background.
        let emailSent = false;
        let emailError = null;
        try {
            await transporter.sendMail(mailOptions);
            emailSent = true;
            console.log('✅ Trigger-alert email sent');
        } catch (mailErr) {
            emailError = mailErr.message;
            console.error('sendMail (trigger-alert):', mailErr.message);
        }

        res.json({
            success: emailSent,
            message: emailSent ? 'Emergency alert sent' : `Emergency alert email failed to send: ${emailError}`,
        });
    } catch (error) {
        console.error('Error triggering alert:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/stop', async (req, res) => {
    try {
        const { userId, pin } = req.body;

        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (session.pin !== pin) {
            return res.status(401).json({ success: false, message: 'Incorrect PIN' });
        }

        await liveSessionStop(userId);

        res.json({ success: true, message: 'Tracking stopped' });
    } catch (error) {
        console.error('Error stopping tracking:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Server error',
        });
    }
});

router.post('/dashboard-alert', async (req, res) => {
    try {
        const { location, userEmail, userName, contacts, userId } = req.body;

        console.log('📩 dashboard-alert received:', JSON.stringify({
            userName, userEmail, userId,
            contactsFromFrontend: contacts,
            hasLocation: !!location,
        }));

        const mapLink = location
            ? `https://maps.google.com/?q=${location.lat},${location.lng}`
            : 'Location not available';

        // ── 1. Fetch real contacts from Firestore (has phone numbers) ────────
        let firestoreContacts = [];
        if (userId) {
            try {
                const userDoc = await usersFindById(userId);
                if (userDoc && userDoc.emergencyContacts) {
                    firestoreContacts = userDoc.emergencyContacts.filter(c => c.phone || c.email);
                    console.log(`📋 Firestore contacts found: ${firestoreContacts.length}`, firestoreContacts.map(c => ({ name: c.name, email: c.email, phone: c.phone ? '✓' : '✗' })));
                } else {
                    console.log('📋 Firestore user found but no emergencyContacts field');
                }
            } catch (e) {
                console.warn('dashboard-alert: could not fetch user from Firestore:', e.message);
            }
        } else {
            console.warn('dashboard-alert: no userId provided — cannot look up Firestore contacts');
        }

        // Merge emails from all sources
        let allEmails = [];
        if (firestoreContacts && firestoreContacts.length > 0) {
            allEmails = allEmails.concat(firestoreContacts.map(c => c.email));
        }
        if (contacts && Array.isArray(contacts) && contacts.length > 0) {
            const mappedContacts = contacts.map(c => typeof c === 'string' ? c : c.email);
            allEmails = allEmails.concat(mappedContacts);
        }

        // Remove duplicates and empty/undefined values
        let emailRecipients = [...new Set(allEmails.filter(e => e && String(e).trim().length > 0 && String(e).includes('@')))];

        // Fallback: if no emergency contact emails, send to the user's own email
        if (emailRecipients.length === 0 && userEmail && String(userEmail).includes('@')) {
            console.warn('dashboard-alert: no emergency contact emails found — falling back to user email:', userEmail);
            emailRecipients = [userEmail];
        }

        console.log(`📧 Final email recipients (${emailRecipients.length}):`, emailRecipients);

        // ── 2. Send SMS to all contacts that have a phone number ─────────────
        const smsResults = [];
        if (firestoreContacts.length > 0) {
            const loc = location
                ? { latitude: location.lat, longitude: location.lng }
                : null;
            const smsRes = await smsService.sendBulkEmergencyAlerts(
                firestoreContacts,
                userName || 'User',
                loc,
                null
            );
            smsResults.push(...smsRes);
            const sent    = smsRes.filter(r => r.success).length;
            const skipped = smsRes.filter(r => !r.success).length;
            console.log(`📱 dashboard-alert SMS: ${sent} sent, ${skipped} failed/skipped`);
        } else {
            console.log('ℹ️  dashboard-alert: no Firestore contacts — SMS skipped');
        }

        // ── 3. Send Email ────────────────────────────────────────────────────
        let emailSentCount = 0;
        if (hasEmailConfig() && emailRecipients.length > 0) {
            const mailOptions = {
                from: `"HerShield Safety" <${process.env.EMAIL_USER}>`,
                to: emailRecipients,
                subject: `🚨 URGENT: Emergency Alert from ${userName || 'User'}`,
                html: `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                        <div style="background: linear-gradient(135deg, #9B8EC7, #7A6B99); color: white; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; font-size: 28px; text-transform: uppercase; letter-spacing: 2px;">SOS Alert</h1>
                            <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Immediate Assistance Requested</p>
                        </div>
                        <div style="padding: 30px; background-color: #fff;">
                            <p style="font-size: 18px; color: #333; line-height: 1.6; text-align: center; margin-bottom: 30px;">
                                <strong>${userName || 'A HerShield User'}</strong> has triggered an emergency alert.
                            </p>
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 12px; border-left: 5px solid #7A6B99; margin-bottom: 30px;">
                                <h3 style="margin-top: 0; color: #2d3436; font-size: 18px; margin-bottom: 15px;">📍 Current Status</h3>
                                <p style="margin: 8px 0;"><strong>User:</strong> ${userName || 'Unknown'}</p>
                                <p style="margin: 8px 0;"><strong>Email:</strong> ${userEmail || 'Not provided'}</p>
                                <p style="margin: 8px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                                <p style="margin: 8px 0;"><strong>Location:</strong> ${location ? `${location.lat}, ${location.lng}` : 'Unknown'}</p>
                            </div>
                            <div style="text-align: center; margin-bottom: 30px;">
                                <a href="${mapLink}" style="background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block;">📍 View Location on Map</a>
                            </div>
                            <p style="font-size: 14px; color: #666; text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                                This alert was sent via HerShield. Please verify the user's safety immediately.
                            </p>
                        </div>
                    </div>`,
            };
            try {
                await transporter.sendMail(mailOptions);
                emailSentCount = emailRecipients.length;
                console.log(`✅ Dashboard alert email sent to ${emailRecipients.join(', ')}`);
            } catch (mailErr) {
                console.error('sendMail (dashboard-alert):', mailErr.message);
            }
        }

        // ── 4. Persist to community alerts ───────────────────────────────────
        let alertPersisted = true;
        const alertId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        try {
            await communityInsert({
                _id: alertId,
                kind: 'alert',
                title: `Emergency Alert: ${userName || 'User'}`,
                message: `${userName || 'User'} triggered an emergency alert from dashboard.`,
                severity: 'high',
                userId,
                userEmail,
                location,
                createdAt: new Date(),
            });
        } catch (e) {
            console.warn('dashboard-alert: communityInsert failed:', e.message);
            alertPersisted = false;
        }

        // ── 5. Write to SOS history so the dashboard history section shows it ─
        if (userId) {
            try {
                const now = new Date();
                const loc = location
                    ? { latitude: location.lat, longitude: location.lng }
                    : null;
                await sosCreate({
                    _id: `dashboard_alert_${alertId}`,
                    userId,
                    userName: userName || 'User',
                    userEmail: userEmail || '',
                    status: 'safe',   // dashboard alerts are point-in-time; no PIN-based session
                    location: loc,
                    trackingCode: null,
                    trackingLink: null,
                    pinHash: null,
                    timerMinutes: null,
                    triggeredAt: now,
                    expiresAt: null,
                    resolvedAt: now,
                    contactCount: firestoreContacts.length || (contacts ? contacts.length : 0),
                    source: 'dashboard',
                });
                console.log(`📝 dashboard-alert: SOS history record written for userId=${userId}`);
            } catch (e) {
                console.warn('dashboard-alert: sosCreate failed (non-fatal):', e.message);
            }
        }

        const smsSent    = smsResults.filter(r => r.success).length;
        const smsFailed  = smsResults.filter(r => !r.success).length;

        return res.json({
            success: true,
            message: 'Emergency alert dispatched.',
            notifications: {
                sms:   { sent: smsSent, failed: smsFailed },
                email: { sent: emailSentCount, failed: emailRecipients.length - emailSentCount },
            },
            alertPersisted,
        });

    } catch (err) {
        console.error('dashboard-alert error:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Resolve tracking code → session userId (for email links with ?code=)
router.get('/lookup-code/:code', async (req, res) => {
    try {
        const code = (req.params.code || '').trim();
        if (!code) {
            return res.status(400).json({ success: false, message: 'Tracking code required' });
        }
        const session = await liveSessionFindByCode(code);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Invalid or expired tracking code' });
        }
        return res.json({
            success: true,
            userId: session.userId,
            isTrackingActive: session.isTrackingActive !== false,
            name: session.name || 'HerShield User',
        });
    } catch (err) {
        console.error('lookup-code error:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * GET /api/live-tracker/history/:userEmail
 * Returns all live-tracking sessions for the given email address,
 * used to populate the private "My Emergency Alert History" panel.
 */
router.get('/history/:userEmail', async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.userEmail || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Valid email required.' });
        }
        const sessions = await liveSessionsByEmail(email);
        const formatted = sessions.map((s) => ({
            _id:              s._id || s.userId,
            sessionId:        s.userId,
            name:             s.name,
            source:           s.source,
            destination:      s.destination,
            transportMode:    s.transportMode,
            isTrackingActive: s.isTrackingActive,
            trackingLink:     s.trackingLink,
            startedAt:        s.createdAt,
            lastVerified:     s.lastVerified,
            contactCount:     Array.isArray(s.emergencyContacts) ? s.emergencyContacts.length : 0,
        }));
        return res.json({ success: true, sessions: formatted, count: formatted.length });
    } catch (err) {
        console.error('live-tracker history error:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
