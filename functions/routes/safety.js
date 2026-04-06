const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const IncidentReport = require('../models/IncidentReport');
const User = require('../models/User');
const safetyAnalytics = require('../services/safetyAnalytics');

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
            west: parseFloat(west) || -180
        };

        const currentHour = timeOfDay ? parseInt(timeOfDay) : new Date().getHours();

        const heatmapData = await safetyAnalytics.generateHeatmapData(bounds, currentHour);

        res.json({
            success: true,
            data: heatmapData,
            count: heatmapData.length
        });

    } catch (error) {
        console.error('Error generating heatmap:', error);
        res.status(500).json({ error: 'Failed to generate heatmap data' });
    }
});

/**
 * @route   POST /api/safety/route
 * @desc    Calculate safety score for a route
 * @access  Public
 */
router.post('/route', [
    body('routePoints').isArray().withMessage('Route points must be an array'),
    body('timeOfDay').optional().isInt({ min: 0, max: 23 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { routePoints, timeOfDay } = req.body;
        const currentHour = timeOfDay !== undefined ? timeOfDay : new Date().getHours();

        const safetyAnalysis = await safetyAnalytics.calculateRouteSafety(
            routePoints,
            currentHour
        );

        res.json({
            success: true,
            ...safetyAnalysis
        });

    } catch (error) {
        console.error('Error calculating route safety:', error);
        res.status(500).json({ error: 'Failed to calculate route safety' });
    }
});

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
            west
        } = req.query;

        const query = {};

        // Filter by status
        if (status) {
            query.status = { $in: status.split(',') };
        }

        // Filter by severity
        if (severity) {
            query.severity = { $in: severity.split(',') };
        }

        // Filter by incident type
        if (incidentType) {
            query.incidentType = { $in: incidentType.split(',') };
        }

        // Filter by geographic bounds
        if (north && south && east && west) {
            query['location.coordinates.latitude'] = {
                $gte: parseFloat(south),
                $lte: parseFloat(north)
            };
            query['location.coordinates.longitude'] = {
                $gte: parseFloat(west),
                $lte: parseFloat(east)
            };
        }

        const incidents = await IncidentReport.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .select('-adminNotes -votedBy');

        res.json({
            success: true,
            incidents,
            count: incidents.length
        });

    } catch (error) {
        console.error('Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

/**
 * @route   POST /api/safety/report
 * @desc    Submit incident report
 * @access  Private
 */
router.post('/report', [
    body('userId').notEmpty(),
    body('reporterName').notEmpty().trim(),
    body('incidentType').notEmpty().isIn([
        'harassment', 'assault', 'theft', 'suspicious_activity',
        'poor_lighting', 'unsafe_area', 'other'
    ]),
    body('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('location').isObject(),
    body('location.coordinates.latitude').isFloat(),
    body('location.coordinates.longitude').isFloat(),
    body('description').notEmpty().trim(),
    body('incidentTime').notEmpty()
], async (req, res) => {
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
            tags
        } = req.body;

        // Verify user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Create incident report
        const report = new IncidentReport({
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
            tags: tags || []
        });

        await report.save();

        // Update user statistics
        await user.updateStats('incidentReports');

        res.json({
            success: true,
            message: 'Incident report submitted successfully',
            reportId: report._id,
            report
        });

    } catch (error) {
        console.error('Error submitting incident report:', error);
        res.status(500).json({ error: 'Failed to submit incident report' });
    }
});

/**
 * @route   POST /api/safety/incidents/:id/vote
 * @desc    Vote on incident report
 * @access  Private
 */
router.post('/incidents/:id/vote', [
    body('userId').notEmpty(),
    body('voteType').isIn(['up', 'down'])
], async (req, res) => {
    try {
        const { userId, voteType } = req.body;

        const report = await IncidentReport.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Incident report not found' });
        }

        await report.addVote(userId, voteType);

        res.json({
            success: true,
            upvotes: report.upvotes,
            downvotes: report.downvotes,
            verificationScore: report.verificationScore
        });

    } catch (error) {
        console.error('Error voting on incident:', error);
        res.status(500).json({ error: 'Failed to vote on incident' });
    }
});

/**
 * @route   POST /api/safety/incidents/:id/comment
 * @desc    Add comment to incident report
 * @access  Private
 */
router.post('/incidents/:id/comment', [
    body('userId').notEmpty(),
    body('userName').notEmpty(),
    body('comment').notEmpty().trim()
], async (req, res) => {
    try {
        const { userId, userName, comment } = req.body;

        const report = await IncidentReport.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Incident report not found' });
        }

        await report.addComment(userId, userName, comment);

        res.json({
            success: true,
            comments: report.comments
        });

    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

/**
 * @route   GET /api/safety/stats
 * @desc    Get safety statistics
 * @access  Public
 */
router.get('/stats', async (req, res) => {
    try {
        const totalIncidents = await IncidentReport.countDocuments();
        const verifiedIncidents = await IncidentReport.countDocuments({ status: 'verified' });

        const severityCounts = await IncidentReport.aggregate([
            { $match: { status: { $in: ['verified', 'investigating'] } } },
            { $group: { _id: '$severity', count: { $sum: 1 } } }
        ]);

        const typeCounts = await IncidentReport.aggregate([
            { $match: { status: { $in: ['verified', 'investigating'] } } },
            { $group: { _id: '$incidentType', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            stats: {
                totalIncidents,
                verifiedIncidents,
                bySeverity: severityCounts.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
                byType: typeCounts.reduce((acc, item) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Error fetching safety stats:', error);
        res.status(500).json({ error: 'Failed to fetch safety statistics' });
    }
});

module.exports = router;
