const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const {
    liveSessionCreate,
    liveSessionGetByUserId,
    liveSessionSetVerified,
    liveSessionPushLocation,
    liveSessionStop,
    communityInsert,
} = require('../services/firestoreRepository');

function hasEmailConfig() {
    const u = process.env.EMAIL_USER && String(process.env.EMAIL_USER).trim();
    const p = process.env.EMAIL_PASS && String(process.env.EMAIL_PASS).trim();
    return !!(u && p);
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

router.post('/start', async (req, res) => {
    try {
        const { name, source, destination, pin, emergencyContacts, transportMode, email, startLat, startLng, baseUrl } = req.body;

        const userEmail = email || process.env.EMAIL_USER;
        const userId    = Date.now().toString() + Math.floor(Math.random() * 1000);
        const trackingCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        // ── Tracking link — use origin sent by browser so it works on any network ──
        const origin       = baseUrl || process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
        const trackingLink = `${origin}/live-tracker.html?track=${userId}`;

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

            try {
                await transporter.sendMail({
                    from: `"HerShield Safety" <${process.env.EMAIL_USER}>`,
                    to: emergencyContacts,
                    subject: `📡 ${name || 'A HerShield User'} started Live Tracking – Stay Alert`,
                    html,
                });
                console.log(`✅ Tracking start email sent to: ${emergencyContacts.join(', ')}`);
            } catch (mailErr) {
                // Non-fatal – session already created, just log the error
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
        const { userId, lat, lng } = req.body;

        const session = await liveSessionGetByUserId(userId);
        if (!session) {
            return res.status(404).json({ success: false, message: 'Session not found' });
        }

        if (!session.isTrackingActive) {
            return res.status(400).json({ success: false, message: 'Tracking is not active' });
        }

        await liveSessionPushLocation(userId, lat, lng);

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
            from: process.env.EMAIL_USER,
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

        try {
            await transporter.sendMail(mailOptions);
        } catch (mailErr) {
            console.error('sendMail (trigger-alert):', mailErr);
            return res.status(502).json({
                success: false,
                message: `Email send failed: ${mailErr.message || 'check EMAIL_USER / EMAIL_PASS'}`,
            });
        }

        res.json({ success: true, message: 'Emergency alert sent' });
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
        const { location, userEmail, userName, contacts } = req.body;

        const mapLink = location
            ? `https://maps.google.com/?q=${location.lat},${location.lng}`
            : 'Location not available';

        const recipients = contacts && contacts.length > 0 ? contacts : process.env.EMAIL_USER;

        if (!hasEmailConfig()) {
            return res.status(503).json({
                success: false,
                message:
                    'Email is not configured. Set EMAIL_USER and EMAIL_PASS in .env to send dashboard SOS emails.',
            });
        }

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: recipients,
            subject: `🚨 URGENT: Emergency Alert from ${userName || 'User'}`,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <div style="background: linear-gradient(135deg, #9B8EC7, #7A6B99); color: white; padding: 30px; text-align: center;">
                        <h1 style="margin: 0; font-size: 28px; text-transform: uppercase; letter-spacing: 2px;">SOS Alert</h1>
                        <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">Immediate Assistance Requested</p>
                    </div>
                    
                    <div style="padding: 30px; background-color: #fff;">
                        <p style="font-size: 18px; color: #333; line-height: 1.6; text-align: center; margin-bottom: 30px;">
                            <strong>${userName || 'A Her Shield User'}</strong> has triggered an emergency alert from their dashboard.
                        </p>
                        
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 12px; border-left: 5px solid #7A6B99; margin-bottom: 30px;">
                            <h3 style="margin-top: 0; color: #2d3436; font-size: 18px; margin-bottom: 15px;">📍 Current Status</h3>
                            <p style="margin: 8px 0;"><strong>User:</strong> ${userName || 'Unknown'}</p>
                            <p style="margin: 8px 0;"><strong>Email:</strong> ${userEmail || 'Not provided'}</p>
                            <p style="margin: 8px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                            <p style="margin: 8px 0;"><strong>Location:</strong> ${location ? `${location.lat}, ${location.lng}` : 'Unknown'}</p>
                        </div>

                        <div style="text-align: center; margin-bottom: 30px;">
                            <a href="${mapLink}" style="background: linear-gradient(135deg, #007bff, #0056b3); color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 15px rgba(0,123,255,0.3);">
                                📍 View Live Location
                            </a>
                        </div>
                        
                        <p style="font-size: 14px; color: #666; text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                            This alert was sent via the Her Shield Dashboard. Please verify the user's safety immediately.
                        </p>
                    </div>
                </div>
            `,
        };

        try {
            await transporter.sendMail(mailOptions);
        } catch (mailErr) {
            console.error('sendMail (dashboard-alert):', mailErr);
            return res.status(502).json({
                success: false,
                message: `Email send failed: ${mailErr.message || 'check EMAIL_USER / EMAIL_PASS'}`,
            });
        }

        let alertPersisted = true;
        try {
            await communityInsert({
                _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                kind: 'alert',
                title: `Emergency Alert: ${userName || 'User'}`,
                message: `${userName || 'User'} triggered an emergency alert from dashboard.`,
                severity: 'high',
                location: location ? `${location.lat}, ${location.lng}` : '',
                source: 'dashboard-sos',
                userName: userName || 'Her Shield User',
                userEmail: userEmail || '',
                createdAt: new Date().toISOString(),
            });
        } catch (persistErr) {
            if (persistErr.code === 'FIRESTORE_NOT_CONFIGURED') {
                alertPersisted = false;
                console.warn(
                    'SOS email sent but alert not saved to Firestore (set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON).'
                );
            } else {
                throw persistErr;
            }
        }

        res.json({
            success: true,
            message: 'Emergency alert sent successfully',
            ...(!alertPersisted && {
                warning: 'Email was sent, but the alert was not stored (configure Firestore for admin visibility).',
            }),
        });
    } catch (error) {
        console.error('Error sending dashboard alert:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to send alert',
        });
    }
});

module.exports = router;
