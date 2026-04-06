const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const TrackingSession = require('../models/TrackingSession');
const smsService = require('../services/smsService');
const whatsappService = require('../services/whatsappService');

/**
 * @route   POST /api/emergency/trigger
 * @desc    Trigger emergency SOS alert
 * @access  Private
 */
router.post('/trigger', [
    body('userId').notEmpty().withMessage('User ID is required'),
    body('location').isObject().withMessage('Location is required'),
    body('location.latitude').isFloat().withMessage('Valid latitude required'),
    body('location.longitude').isFloat().withMessage('Valid longitude required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId, location, sessionId, message } = req.body;

        // Get user and emergency contacts
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.emergencyContacts || user.emergencyContacts.length === 0) {
            return res.status(400).json({
                error: 'No emergency contacts configured',
                message: 'Please add emergency contacts in your profile'
            });
        }

        // Generate tracking link if session exists
        let trackingLink = null;
        if (sessionId) {
            const session = await TrackingSession.findById(sessionId);
            if (session) {
                trackingLink = `${process.env.APP_URL || 'http://localhost:3000'}/live-tracker.html?code=${session.trackingCode}`;

                // Log emergency alert in session
                session.emergencyAlerts.push({
                    location,
                    notificationsSent: []
                });
                await session.save();
            }
        }

        // Send alerts based on user preferences
        const alertMethod = user.safetyPreferences.preferredAlertMethod || 'both';
        const results = [];

        // Sort contacts by priority
        const sortedContacts = user.emergencyContacts.sort((a, b) =>
            (b.priority || 1) - (a.priority || 1)
        );

        // Send SMS alerts
        if (alertMethod === 'sms' || alertMethod === 'both') {
            const smsResults = await smsService.sendBulkEmergencyAlerts(
                sortedContacts,
                user.name,
                location,
                trackingLink
            );
            results.push(...smsResults.map(r => ({ ...r, method: 'sms' })));
        }

        // Send WhatsApp alerts
        if (alertMethod === 'whatsapp' || alertMethod === 'both') {
            const whatsappResults = await whatsappService.sendBulkEmergencyAlerts(
                sortedContacts,
                user.name,
                location,
                trackingLink
            );
            results.push(...whatsappResults.map(r => ({ ...r, method: 'whatsapp' })));
        }

        // Update user statistics
        await user.updateStats('emergencyAlerts');

        res.json({
            success: true,
            message: 'Emergency alerts sent successfully',
            alertsSent: results.filter(r => r.success).length,
            totalContacts: sortedContacts.length,
            results,
            trackingLink
        });

    } catch (error) {
        console.error('Error triggering emergency:', error);
        res.status(500).json({
            error: 'Failed to trigger emergency alert',
            message: error.message
        });
    }
});

/**
 * @route   POST /api/emergency/contacts
 * @desc    Add emergency contact
 * @access  Private
 */
router.post('/contacts', [
    body('userId').notEmpty(),
    body('name').notEmpty().trim(),
    body('phone').notEmpty().trim(),
    body('relationship').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId, name, phone, relationship, priority } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Format phone number
        const formattedPhone = smsService.formatPhoneNumber(phone);

        // Validate phone number
        if (!smsService.validatePhoneNumber(formattedPhone)) {
            return res.status(400).json({
                error: 'Invalid phone number format',
                message: 'Phone number must be in international format (e.g., +919876543210)'
            });
        }

        // Add contact
        await user.addEmergencyContact({
            name,
            phone: formattedPhone,
            relationship: relationship || 'Emergency Contact',
            priority: priority || 1
        });

        res.json({
            success: true,
            message: 'Emergency contact added successfully',
            contacts: user.emergencyContacts
        });

    } catch (error) {
        console.error('Error adding emergency contact:', error);
        res.status(500).json({ error: 'Failed to add emergency contact' });
    }
});

/**
 * @route   GET /api/emergency/contacts/:userId
 * @desc    Get user's emergency contacts
 * @access  Private
 */
router.get('/contacts/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            contacts: user.emergencyContacts
        });

    } catch (error) {
        console.error('Error fetching emergency contacts:', error);
        res.status(500).json({ error: 'Failed to fetch emergency contacts' });
    }
});

/**
 * @route   DELETE /api/emergency/contacts/:userId/:contactId
 * @desc    Remove emergency contact
 * @access  Private
 */
router.delete('/contacts/:userId/:contactId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await user.removeEmergencyContact(req.params.contactId);

        res.json({
            success: true,
            message: 'Emergency contact removed successfully',
            contacts: user.emergencyContacts
        });

    } catch (error) {
        console.error('Error removing emergency contact:', error);
        res.status(500).json({ error: 'Failed to remove emergency contact' });
    }
});

/**
 * @route   POST /api/emergency/send-location
 * @desc    Share current location with emergency contacts
 * @access  Private
 */
router.post('/send-location', [
    body('userId').notEmpty(),
    body('location').isObject(),
    body('message').optional()
], async (req, res) => {
    try {
        const { userId, location, message } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const results = [];

        // Send location to all emergency contacts
        for (const contact of user.emergencyContacts) {
            const smsResult = await smsService.sendLocationUpdate({
                to: contact.phone,
                userName: user.name,
                location,
                message
            });

            results.push({
                contactName: contact.name,
                ...smsResult
            });
        }

        res.json({
            success: true,
            message: 'Location shared with emergency contacts',
            results
        });

    } catch (error) {
        console.error('Error sharing location:', error);
        res.status(500).json({ error: 'Failed to share location' });
    }
});

module.exports = router;
