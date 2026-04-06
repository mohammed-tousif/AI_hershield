const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const TrackingSession = require('../models/TrackingSession');
const User = require('../models/User');

/**
 * @route   POST /api/tracking/start
 * @desc    Start a new tracking session
 * @access  Private
 */
router.post('/start', [
    body('userId').notEmpty(),
    body('name').notEmpty().trim(),
    body('phone').notEmpty().trim(),
    body('travelMode').optional().isIn(['walking', 'driving', 'public_transport', 'cycling']),
    body('startPoint').optional().isObject(),
    body('destination').optional().isObject()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { userId, name, phone, travelMode, startPoint, destination, estimatedDuration } = req.body;

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate unique tracking code
        let trackingCode;
        let isUnique = false;
        while (!isUnique) {
            trackingCode = TrackingSession.generateTrackingCode();
            const existing = await TrackingSession.findOne({ trackingCode });
            if (!existing) isUnique = true;
        }

        // Create new tracking session
        const session = new TrackingSession({
            userId,
            trackingCode,
            name,
            phone,
            travelMode: travelMode || 'walking',
            startPoint,
            destination,
            estimatedDuration,
            status: 'active'
        });

        await session.save();

        // Update user statistics
        await user.updateStats('totalTrips');

        res.json({
            success: true,
            message: 'Tracking session started',
            session: {
                _id: session._id,
                trackingCode: session.trackingCode,
                startTime: session.startTime,
                status: session.status
            },
            shareLink: `${process.env.APP_URL || 'http://localhost:3000'}/live-tracker.html?code=${trackingCode}`
        });

    } catch (error) {
        console.error('Error starting tracking session:', error);
        res.status(500).json({ error: 'Failed to start tracking session' });
    }
});

/**
 * @route   GET /api/tracking/session/:id
 * @desc    Get tracking session details
 * @access  Public (with tracking code)
 */
router.get('/session/:id', async (req, res) => {
    try {
        const session = await TrackingSession.findById(req.params.id)
            .populate('userId', 'name profilePicture');

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        res.json({
            success: true,
            session
        });

    } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});

/**
 * @route   GET /api/tracking/code/:code
 * @desc    Get tracking session by code (for public tracking view)
 * @access  Public
 */
router.get('/code/:code', async (req, res) => {
    try {
        const session = await TrackingSession.findOne({
            trackingCode: req.params.code.toUpperCase()
        }).populate('userId', 'name profilePicture');

        if (!session) {
            return res.status(404).json({ error: 'Invalid tracking code' });
        }

        res.json({
            success: true,
            session
        });

    } catch (error) {
        console.error('Error fetching session by code:', error);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});

/**
 * @route   POST /api/tracking/location
 * @desc    Update current location
 * @access  Private
 */
router.post('/location', [
    body('sessionId').notEmpty(),
    body('location').isObject(),
    body('location.latitude').isFloat(),
    body('location.longitude').isFloat()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { sessionId, location } = req.body;

        const session = await TrackingSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.status !== 'active') {
            return res.status(400).json({ error: 'Session is not active' });
        }

        // Add to location history
        session.locationHistory.push({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            speed: location.speed,
            heading: location.heading,
            timestamp: new Date()
        });

        // Update current location
        session.currentLocation = {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            timestamp: new Date()
        };

        await session.save();

        res.json({
            success: true,
            message: 'Location updated',
            currentLocation: session.currentLocation
        });

    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Failed to update location' });
    }
});

/**
 * @route   POST /api/tracking/checkin
 * @desc    Add check-in point
 * @access  Private
 */
router.post('/checkin', [
    body('sessionId').notEmpty(),
    body('location').isObject(),
    body('message').optional()
], async (req, res) => {
    try {
        const { sessionId, location, message } = req.body;

        const session = await TrackingSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        session.checkIns.push({
            location,
            message,
            timestamp: new Date()
        });

        await session.save();

        res.json({
            success: true,
            message: 'Check-in recorded',
            checkIns: session.checkIns
        });

    } catch (error) {
        console.error('Error recording check-in:', error);
        res.status(500).json({ error: 'Failed to record check-in' });
    }
});

/**
 * @route   POST /api/tracking/end
 * @desc    End tracking session
 * @access  Private
 */
router.post('/end', [
    body('sessionId').notEmpty()
], async (req, res) => {
    try {
        const { sessionId, safetyScore, notes } = req.body;

        const session = await TrackingSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        session.status = 'completed';
        session.endTime = new Date();
        session.duration = session.calculateDuration();
        session.totalDistance = session.calculateDistance();

        if (safetyScore) session.safetyScore = safetyScore;
        if (notes) session.notes = notes;

        await session.save();

        // Update user statistics
        const user = await User.findById(session.userId);
        if (user) {
            await user.updateStats('safeTrips');
        }

        res.json({
            success: true,
            message: 'Tracking session ended',
            session: {
                duration: session.duration,
                totalDistance: session.totalDistance,
                safetyScore: session.safetyScore
            }
        });

    } catch (error) {
        console.error('Error ending session:', error);
        res.status(500).json({ error: 'Failed to end session' });
    }
});

/**
 * @route   GET /api/tracking/user/:userId
 * @desc    Get user's tracking history
 * @access  Private
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { limit = 10, status } = req.query;

        const query = { userId: req.params.userId };
        if (status) query.status = status;

        const sessions = await TrackingSession.find(query)
            .sort({ startTime: -1 })
            .limit(parseInt(limit));

        res.json({
            success: true,
            sessions
        });

    } catch (error) {
        console.error('Error fetching tracking history:', error);
        res.status(500).json({ error: 'Failed to fetch tracking history' });
    }
});

module.exports = router;
