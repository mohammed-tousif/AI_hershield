const express = require('express');
const router = express.Router();
const {
    communityInsert,
    communityFindByKind,
    incidentsFetchAll,
    isFirestoreConfigured,
} = require('../services/firestoreRepository');

router.get('/posts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '50', 10);
        if (!isFirestoreConfigured()) {
            return res.json({
                success: true,
                posts: [],
                degraded: true,
                message:
                    'Firestore not configured; set FIREBASE_SERVICE_ACCOUNT_PATH (path to .json key) or FIREBASE_SERVICE_ACCOUNT_JSON — see .env.example.',
            });
        }
        const posts = await communityFindByKind('post', limit);
        res.json({ success: true, posts });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch posts',
            error: error.message,
        });
    }
});

router.post('/posts', async (req, res) => {
    try {
        const { content, userName, userEmail, location, imageUrl, category } = req.body;
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'Post content is required' });
        }

        const post = {
            _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            kind: 'post',
            content: content.trim(),
            userName: userName || 'Community Member',
            userEmail: userEmail || '',
            location: location || '',
            imageUrl: imageUrl || '',
            category: category || 'general',
            likes: 0,
            comments: 0,
            createdAt: new Date().toISOString(),
        };

        await communityInsert(post);
        res.status(201).json({ success: true, message: 'Post created successfully', post });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to create post',
            error: error.message,
        });
    }
});

router.post('/alerts', async (req, res) => {
    try {
        const { title, message, severity, location, source, userName } = req.body;
        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }

        const alert = {
            _id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
            kind: 'alert',
            title,
            message,
            severity: severity || 'medium',
            location: location || '',
            source: source || 'dashboard',
            userName: userName || 'Her Shield User',
            createdAt: new Date().toISOString(),
        };

        await communityInsert(alert);
        res.status(201).json({ success: true, alert });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to create alert',
            error: error.message,
        });
    }
});

router.get('/alerts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '20', 10);
        if (!isFirestoreConfigured()) {
            return res.json({
                success: true,
                alerts: [],
                degraded: true,
                message:
                    'Firestore not configured; set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON — see .env.example.',
            });
        }
        const alerts = await communityFindByKind('alert', limit);

        const allIncidents = await incidentsFetchAll();
        const incidentAlerts = allIncidents
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
            .slice(0, limit)
            .map((incident) => ({
                _id: incident._id,
                kind: 'alert',
                title: `${incident.incidentType || 'Incident'} - ${(incident.severity || 'medium').toUpperCase()}`,
                message: incident.description || 'Community safety incident reported',
                severity: (incident.severity || 'medium').toLowerCase(),
                location: incident?.location?.address || '',
                source: 'incident-report',
                userName: incident.reporterName || 'Anonymous',
                createdAt: incident.createdAt || new Date().toISOString(),
            }));

        const merged = [...alerts, ...incidentAlerts]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);

        res.json({ success: true, alerts: merged });
    } catch (error) {
        const status = error.statusCode || 500;
        res.status(status).json({
            success: false,
            message: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch alerts',
            error: error.message,
        });
    }
});

module.exports = router;
