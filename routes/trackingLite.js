const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const {
    trackingCodeExists,
    trackingCreate,
    trackingFindById,
    trackingFindByCode,
    trackingUpdate,
    trackingFindByUserId,
    usersFindById,
    usersSave,
} = require('../services/firestoreRepository');

function genCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function uniqueCode() {
    let code = genCode();
    while (await trackingCodeExists(code)) code = genCode();
    return code;
}

router.post(
    '/start',
    [body('userId').notEmpty(), body('name').notEmpty().trim(), body('phone').notEmpty().trim()],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { userId, name, phone, travelMode, startPoint, destination, estimatedDuration } = req.body;
            const user = await usersFindById(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });

            const trackingCode = await uniqueCode();
            const session = {
                _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                userId,
                trackingCode,
                name,
                phone,
                travelMode: travelMode || 'walking',
                startPoint: startPoint || null,
                destination: destination || null,
                estimatedDuration: estimatedDuration || null,
                startTime: new Date(),
                endTime: null,
                status: 'active',
                currentLocation: null,
                locationHistory: [],
                checkIns: [],
                emergencyAlerts: [],
                duration: 0,
                totalDistance: 0,
                safetyScore: null,
                notes: null,
            };
            await trackingCreate(session);

            user.statistics = user.statistics || {};
            user.statistics.totalTrips = (user.statistics.totalTrips || 0) + 1;
            await usersSave(user);

            return res.json({
                success: true,
                message: 'Tracking session started',
                session: {
                    _id: session._id,
                    trackingCode: session.trackingCode,
                    startTime: session.startTime,
                    status: session.status,
                },
                shareLink: `${process.env.APP_URL || 'http://localhost:3000'}/live-tracker.html?code=${trackingCode}`,
            });
        } catch (error) {
            console.error('tracking/start:', error);
            const status = error.statusCode || 500;
            return res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to start session',
            });
        }
    }
);

router.get('/session/:id', async (req, res) => {
    try {
        const session = await trackingFindById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        return res.json({ success: true, session });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to load session',
        });
    }
});

router.get('/code/:code', async (req, res) => {
    try {
        const session = await trackingFindByCode(req.params.code);
        if (!session) return res.status(404).json({ error: 'Invalid tracking code' });
        return res.json({ success: true, session });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to load session',
        });
    }
});

router.post(
    '/location',
    [
        body('sessionId').notEmpty(),
        body('location').isObject(),
        body('location.latitude').isFloat(),
        body('location.longitude').isFloat(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

            const { sessionId, location } = req.body;
            const session = await trackingFindById(sessionId);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active' });

            const point = {
                latitude: location.latitude,
                longitude: location.longitude,
                accuracy: location.accuracy,
                speed: location.speed,
                heading: location.heading,
                timestamp: new Date(),
            };
            session.locationHistory = session.locationHistory || [];
            session.locationHistory.push(point);
            session.currentLocation = point;
            await trackingUpdate(session);

            return res.json({
                success: true,
                message: 'Location updated',
                currentLocation: session.currentLocation,
            });
        } catch (error) {
            const status = error.statusCode || 500;
            return res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to update location',
            });
        }
    }
);

router.post('/checkin', [body('sessionId').notEmpty(), body('location').isObject()], async (req, res) => {
    try {
        const { sessionId, location, message } = req.body;
        const session = await trackingFindById(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        session.checkIns = session.checkIns || [];
        session.checkIns.push({ location, message, timestamp: new Date() });
        await trackingUpdate(session);
        return res.json({ success: true, message: 'Check-in recorded', checkIns: session.checkIns });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to record check-in',
        });
    }
});

router.post('/end', [body('sessionId').notEmpty()], async (req, res) => {
    try {
        const { sessionId, safetyScore, notes } = req.body;
        const session = await trackingFindById(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        session.status = 'completed';
        session.endTime = new Date();
        session.duration = Math.max(
            0,
            Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000)
        );
        if (safetyScore !== undefined) session.safetyScore = safetyScore;
        if (notes) session.notes = notes;
        await trackingUpdate(session);

        const user = await usersFindById(session.userId);
        if (user) {
            user.statistics = user.statistics || {};
            user.statistics.safeTrips = (user.statistics.safeTrips || 0) + 1;
            await usersSave(user);
        }

        return res.json({
            success: true,
            message: 'Tracking session ended',
            session: {
                duration: session.duration,
                totalDistance: session.totalDistance || 0,
                safetyScore: session.safetyScore,
            },
        });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to end session',
        });
    }
});

router.get('/user/:userId', async (req, res) => {
    try {
        const { limit = 10, status } = req.query;
        const sessions = await trackingFindByUserId(req.params.userId, {
            limit: parseInt(limit, 10),
            status: status || undefined,
        });
        return res.json({ success: true, sessions });
    } catch (error) {
        const status = error.statusCode || 500;
        return res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to list sessions',
        });
    }
});

module.exports = router;
