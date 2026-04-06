const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const safetyAnalytics = require('../services/safetyAnalytics');
const {
    incidentsFetchAll,
    incidentsGetById,
    incidentsCreate,
    incidentsSave,
    usersFindById,
    usersSave,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');

/**
 * @route   GET /api/safety/heatmap
 * @desc    Get safety heatmap data for map visualization
 * @access  Public
 */
router.get('/heatmap', async (req, res) => {
    try {
        const { north, south, east, west, timeOfDay } = req.query;

        const bounds = {
            north: parseFloat(north) || 90,
            south: parseFloat(south) || -90,
            east: parseFloat(east) || 180,
            west: parseFloat(west) || -180,
        };

        const currentHour = timeOfDay ? parseInt(timeOfDay, 10) : new Date().getHours();

        const heatmapData = await safetyAnalytics.generateHeatmapData(bounds, currentHour);

        res.json({
            success: true,
            data: heatmapData,
            count: heatmapData.length,
            userReports: 0,
        });
    } catch (error) {
        console.error('Error generating heatmap:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to generate heatmap data',
        });
    }
});

/**
 * @route   POST /api/safety/route
 * @desc    Calculate safety score for a route
 * @access  Public
 */
router.post(
    '/route',
    [
        body('routePoints').isArray().withMessage('Route points must be an array'),
        body('timeOfDay').optional().isInt({ min: 0, max: 23 }),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { routePoints, timeOfDay } = req.body;
            const currentHour = timeOfDay !== undefined ? timeOfDay : new Date().getHours();

            const safetyAnalysis = await safetyAnalytics.calculateRouteSafety(routePoints, currentHour);

            res.json({
                success: true,
                ...safetyAnalysis,
            });
        } catch (error) {
            console.error('Error calculating route safety:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error:
                    error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to calculate route safety',
            });
        }
    }
);

/**
 * @route   GET /api/safety/incidents
 * @desc    Get incident reports
 * @access  Public
 */
router.get('/incidents', async (req, res) => {
    try {
        const {
            limit = 50,
            status = 'verified',
            severity,
            incidentType,
            north,
            south,
            east,
            west,
        } = req.query;

        if (!isFirestoreConfigured()) {
            return res.json({
                success: true,
                incidents: [],
                count: 0,
                degraded: true,
                message: 'Firestore not configured; no incident list available.',
            });
        }

        const incidentsAll = await incidentsFetchAll();
        let incidents = incidentsAll.filter((i) => !status || status.split(',').includes(i.status));
        if (severity) incidents = incidents.filter((i) => severity.split(',').includes(i.severity));
        if (incidentType) incidents = incidents.filter((i) => incidentType.split(',').includes(i.incidentType));
        if (north != null && south != null && east != null && west != null) {
            const n = parseFloat(north);
            const s = parseFloat(south);
            const e = parseFloat(east);
            const w = parseFloat(west);
            if (Number.isFinite(n) && Number.isFinite(s) && Number.isFinite(e) && Number.isFinite(w)) {
                incidents = incidents.filter((i) => {
                    const lat = i?.location?.coordinates?.latitude;
                    const lng = i?.location?.coordinates?.longitude;
                    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
                    return lat >= s && lat <= n && lng >= w && lng <= e;
                });
            }
        }
        incidents = incidents
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, parseInt(limit, 10))
            .map(({ adminNotes, ...rest }) => rest);

        res.json({
            success: true,
            incidents,
            count: incidents.length,
        });
    } catch (error) {
        console.error('Error fetching incidents:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch incidents',
        });
    }
});

/**
 * @route   POST /api/safety/report
 * @desc    Submit incident report (simplified for dashboard) — stored in Firestore
 * @access  Public
 */
router.post('/report', async (req, res) => {
    try {
        const { type, severity, location, description, reporter, timestamp } = req.body;

        const desc = String(description || '').trim();
        const locObj =
            typeof location === 'string'
                ? { address: location, coordinates: null }
                : location && typeof location === 'object'
                  ? location
                  : {};
        const addr = String(locObj.address || '').trim();
        const coords = locObj.coordinates || {};
        const lat = coords.latitude ?? coords.lat;
        const lng = coords.longitude ?? coords.lng;
        const hasCoords =
            lat != null &&
            lng != null &&
            !Number.isNaN(Number(lat)) &&
            !Number.isNaN(Number(lng)) &&
            Math.abs(Number(lat)) <= 90 &&
            Math.abs(Number(lng)) <= 180;

        if (!type || !desc || (!addr && !hasCoords)) {
            return res.status(400).json({
                success: false,
                message:
                    'Missing required fields: issue type, description, and either a location name or GPS coordinates (use “Use GPS”) are required.',
            });
        }

        const incidentData = {
            _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            incidentType: String(type).toLowerCase().replace(/ /g, '_'),
            severity: String(severity || 'medium').toLowerCase(),
            location: {
                address: addr || (typeof location === 'string' ? location : ''),
                coordinates: hasCoords ? { latitude: Number(lat), longitude: Number(lng) } : null,
            },
            description: desc,
            reporterName: reporter?.name || 'Anonymous',
            reporterEmail: reporter?.email || 'anonymous@hershield.app',
            timestamp: timestamp || new Date().toISOString(),
            status: 'pending',
            createdAt: new Date(),
        };

        await incidentsCreate(incidentData);
        console.log('✅ Incident report stored in Firestore:', incidentData.incidentType, incidentData.location.address);

        res.json({
            success: true,
            message: 'Incident report submitted successfully',
            reportId: incidentData._id,
            report: incidentData,
        });
    } catch (error) {
        console.error('Error submitting incident report:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message:
                error.code === 'FIRESTORE_NOT_CONFIGURED'
                    ? error.message
                    : 'Failed to submit incident report',
            error: error.message,
        });
    }
});

/**
 * @route   POST /api/safety/report-full
 * @desc    Submit incident report (full validation + user linkage)
 * @access  Public
 */
router.post(
    '/report-full',
    [
        body('userId').notEmpty(),
        body('reporterName').notEmpty().trim(),
        body('incidentType').notEmpty().isIn([
            'harassment',
            'assault',
            'theft',
            'suspicious_activity',
            'poor_lighting',
            'unsafe_area',
            'other',
        ]),
        body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
        body('location').isObject(),
        body('location.coordinates.latitude').isFloat(),
        body('location.coordinates.longitude').isFloat(),
        body('description').notEmpty().trim(),
        body('incidentTime').notEmpty(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const {
                userId,
                reporterName,
                incidentType,
                severity,
                location,
                description,
                incidentTime,
                images,
                policeReportFiled,
                policeReportNumber,
                isAnonymous,
                tags,
            } = req.body;

            const user = await usersFindById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const report = {
                _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                reportedBy: userId,
                reporterName: isAnonymous ? 'Anonymous' : reporterName,
                incidentType,
                severity: severity || 'medium',
                location,
                description,
                incidentTime: new Date(incidentTime),
                images: images || [],
                policeReportFiled: policeReportFiled || false,
                policeReportNumber,
                isAnonymous: isAnonymous || false,
                tags: tags || [],
                status: 'pending',
                upvotes: 0,
                downvotes: 0,
                votedBy: [],
                comments: [],
                verificationScore: 50,
                createdAt: new Date(),
            };

            await incidentsCreate(report);

            user.statistics = user.statistics || {};
            user.statistics.incidentReports = (user.statistics.incidentReports || 0) + 1;
            await usersSave(user);

            res.json({
                success: true,
                message: 'Incident report submitted successfully',
                reportId: report._id,
                report,
            });
        } catch (error) {
            console.error('Error submitting incident report:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error:
                    error.code === 'FIRESTORE_NOT_CONFIGURED'
                        ? error.message
                        : 'Failed to submit incident report',
            });
        }
    }
);

/**
 * @route   POST /api/safety/incidents/:id/vote
 * @desc    Vote on incident report
 * @access  Private
 */
router.post(
    '/incidents/:id/vote',
    [body('userId').notEmpty(), body('voteType').isIn(['up', 'down'])],
    async (req, res) => {
        try {
            const { userId, voteType } = req.body;
            const report = await incidentsGetById(req.params.id);
            if (!report) {
                return res.status(404).json({ error: 'Incident report not found' });
            }
            report.votedBy = report.votedBy || [];
            report.upvotes = report.upvotes || 0;
            report.downvotes = report.downvotes || 0;
            const existing = report.votedBy.find((v) => v.userId === userId);
            if (existing) {
                if (existing.voteType === voteType) {
                    report.votedBy = report.votedBy.filter((v) => v.userId !== userId);
                    if (voteType === 'up') report.upvotes--;
                    else report.downvotes--;
                } else {
                    existing.voteType = voteType;
                    if (voteType === 'up') {
                        report.upvotes++;
                        report.downvotes--;
                    } else {
                        report.downvotes++;
                        report.upvotes--;
                    }
                }
            } else {
                report.votedBy.push({ userId, voteType, votedAt: new Date() });
                if (voteType === 'up') report.upvotes++;
                else report.downvotes++;
            }
            report.verificationScore = Math.min(100, 50 + (report.upvotes - report.downvotes) * 5);
            await incidentsSave(report);

            res.json({
                success: true,
                upvotes: report.upvotes,
                downvotes: report.downvotes,
                verificationScore: report.verificationScore,
            });
        } catch (error) {
            console.error('Error voting on incident:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to vote on incident',
            });
        }
    }
);

/**
 * @route   POST /api/safety/incidents/:id/comment
 * @desc    Add comment to incident report
 * @access  Private
 */
router.post(
    '/incidents/:id/comment',
    [body('userId').notEmpty(), body('userName').notEmpty(), body('comment').notEmpty().trim()],
    async (req, res) => {
        try {
            const { userId, userName, comment } = req.body;

            const report = await incidentsGetById(req.params.id);
            if (!report) {
                return res.status(404).json({ error: 'Incident report not found' });
            }

            report.comments = report.comments || [];
            report.comments.push({ userId, userName, comment, commentedAt: new Date() });
            await incidentsSave(report);

            res.json({
                success: true,
                comments: report.comments,
            });
        } catch (error) {
            console.error('Error adding comment:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to add comment',
            });
        }
    }
);

/**
 * @route   GET /api/safety/stats
 * @desc    Get safety statistics
 * @access  Public
 */
router.get('/stats', async (req, res) => {
    try {
        if (!isFirestoreConfigured()) {
            return res.json({
                success: true,
                stats: {
                    totalIncidents: 0,
                    verifiedIncidents: 0,
                    bySeverity: {},
                    byType: {},
                },
                degraded: true,
                message: 'Firestore not configured; statistics unavailable.',
            });
        }

        const all = await incidentsFetchAll();
        const totalIncidents = all.length;
        const verifiedIncidents = all.filter((i) => i.status === 'verified').length;
        const active = all.filter((i) => ['verified', 'investigating'].includes(i.status));
        const bySeverity = {};
        const byType = {};
        active.forEach((i) => {
            bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
            byType[i.incidentType] = (byType[i.incidentType] || 0) + 1;
        });

        res.json({
            success: true,
            stats: {
                totalIncidents,
                verifiedIncidents,
                bySeverity,
                byType,
            },
        });
    } catch (error) {
        console.error('Error fetching safety stats:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch safety statistics',
        });
    }
});

module.exports = router;
