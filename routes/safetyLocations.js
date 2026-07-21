const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const {
    safetyLocationsList,
    safetyLocationsAdd,
    safetyLocationsSeedFromCsvIfEmpty,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');
const { stripHtml } = require('../services/sanitize');

function checkValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, details: errors.array() });
    }
    next();
}

const addLocationValidators = [
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('latitude must be between -90 and 90'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('longitude must be between -180 and 180'),
    body('risk_level').isInt({ min: 1, max: 3 }).withMessage('risk_level must be 1, 2, or 3'),
    body('location').trim().notEmpty().withMessage('location is required').isLength({ max: 200 }).withMessage('location must be under 200 characters'),
    body('category').optional({ nullable: true }).isString().isLength({ max: 50 }),
];

/**
 * GET /api/safety/locations
 * All rows stored in Firestore (hershield_safety_locations). Seeds from CSV once if empty.
 */
router.get('/locations', async (req, res) => {
    try {
        if (!isFirestoreConfigured()) {
            return res.json([]);
        }
        await safetyLocationsSeedFromCsvIfEmpty();
        const locations = await safetyLocationsList();
        res.json(locations);
    } catch (error) {
        console.error('Error fetching safety locations:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to load safety locations',
            message: error.message,
        });
    }
});

/**
 * POST /api/safety/locations
 */
router.post('/locations', addLocationValidators, checkValidation, async (req, res) => {
    try {
        const { latitude, longitude, risk_level } = req.body;
        const location = stripHtml(req.body.location.trim());
        const category  = stripHtml(req.body.category || 'incident');

        const newLocation = {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            risk_level: parseInt(risk_level, 10),
            location,
            category,
            last_updated: new Date().toISOString().split('T')[0],
        };

        const saved = await safetyLocationsAdd(newLocation);

        res.status(201).json({
            success: true,
            message: 'Safety location added successfully',
            location: saved,
        });
    } catch (error) {
        console.error('Error adding safety location:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to add safety location',
            message: error.message,
        });
    }
});

/**
 * GET /api/safety/locations/stats
 */
router.get('/locations/stats', async (req, res) => {
    try {
        if (!isFirestoreConfigured()) {
            return res.json({
                total: 0,
                by_risk_level: { low: 0, medium: 0, high: 0 },
                by_category: {},
                degraded: true,
            });
        }
        await safetyLocationsSeedFromCsvIfEmpty();
        const locations = await safetyLocationsList();

        const stats = {
            total: locations.length,
            by_risk_level: {
                low: locations.filter((l) => l.risk_level === 1).length,
                medium: locations.filter((l) => l.risk_level === 2).length,
                high: locations.filter((l) => l.risk_level === 3).length,
            },
            by_category: {},
        };

        locations.forEach((loc) => {
            const cat = loc.category || 'unknown';
            stats.by_category[cat] = (stats.by_category[cat] || 0) + 1;
        });

        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch statistics',
            message: error.message,
        });
    }
});

module.exports = router;
