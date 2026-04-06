const express = require('express');
const router = express.Router();
const {
    safetyLocationsList,
    safetyLocationsAdd,
    safetyLocationsSeedFromCsvIfEmpty,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');

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
router.post('/locations', async (req, res) => {
    try {
        const { latitude, longitude, risk_level, location, category } = req.body;

        if (!latitude || !longitude || !risk_level || !location) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['latitude', 'longitude', 'risk_level', 'location'],
            });
        }

        if (![1, 2, 3].includes(parseInt(risk_level, 10))) {
            return res.status(400).json({
                error: 'Invalid risk_level',
                message: 'risk_level must be 1 (Low), 2 (Medium), or 3 (High)',
            });
        }

        const newLocation = {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            risk_level: parseInt(risk_level, 10),
            location,
            category: category || 'incident',
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
