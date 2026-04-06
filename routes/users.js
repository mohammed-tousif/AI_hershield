const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { usersFindById, usersFindByEmail, usersCreate, usersSave } = require('../services/firestoreRepository');

function defaultPreferences() {
    return {
        autoAlertEnabled: false,
        shareLocationByDefault: true,
        preferredAlertMethod: 'both',
        nightModeAutoActivate: true,
    };
}

function defaultStats() {
    return {
        totalTrips: 0,
        safeTrips: 0,
        emergencyAlerts: 0,
        incidentReports: 0,
    };
}

/**
 * @route   POST /api/users/upsert
 * @desc    Idempotent create-or-update user document keyed by Firebase UID.
 *          Called immediately after every Firebase Auth sign-in so a Firestore
 *          document always exists before any profile/contact operations.
 * @access  Public (validated server-side by firebaseUid presence)
 */
router.post(
    '/upsert',
    [
        body('firebaseUid').notEmpty().withMessage('firebaseUid is required'),
        body('email').isEmail().normalizeEmail(),
        body('name').optional().trim(),
        body('phone').optional().trim(),
        body('photoURL').optional(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { firebaseUid, email, name, phone, photoURL } = req.body;
            const now = new Date();

            // Try to load existing document (keyed by firebaseUid)
            let user = await usersFindById(firebaseUid);

            if (user) {
                // Update mutable fields on each login to keep Firestore in sync
                let changed = false;
                if (name && user.name !== name) { user.name = name; changed = true; }
                if (phone !== undefined && user.phone !== phone) { user.phone = phone; changed = true; }
                if (photoURL && user.profilePicture !== photoURL) { user.profilePicture = photoURL; changed = true; }
                if (changed) {
                    user.updatedAt = now;
                    await usersSave(user);
                }
                return res.json({ success: true, created: false, user: { _id: user._id, email: user.email, name: user.name } });
            }

            // Create new document with Firebase UID as the document ID
            const newUser = {
                _id: firebaseUid,            // ← Firebase UID IS the Firestore doc ID
                firebaseUid,
                email,
                name: name || email.split('@')[0],
                phone: phone || '',
                profilePicture: photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || email)}&background=BDA6CE&color=fff`,
                emergencyContacts: [],
                safetyPreferences: defaultPreferences(),
                statistics: defaultStats(),
                isActive: true,
                role: 'user',               // for future admin dashboard role checks
                createdAt: now,
                updatedAt: now,
            };

            await usersCreate(newUser);

            return res.json({
                success: true,
                created: true,
                user: { _id: newUser._id, email: newUser.email, name: newUser.name },
            });
        } catch (error) {
            console.error('Error upserting user:', error);
            const status = error.statusCode || 500;
            return res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to upsert user',
            });
        }
    }
);

/**
 * @route   POST /api/users/register
 * @desc    Register new user (legacy; prefer /upsert for Firebase-Auth users)
 * @access  Public
 */
router.post(
    '/register',
    [
        body('email').isEmail().normalizeEmail(),
        body('name').notEmpty().trim(),
        body('phone').optional().trim(),
        body('firebaseUid').optional(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { email, name, phone, firebaseUid, profilePicture } = req.body;

            // If firebase UID provided, use it as the doc ID (idempotent)
            const docId = firebaseUid || `${Date.now()}_${Math.floor(Math.random() * 10000)}`;

            const existingUser = await usersFindById(docId).catch(() => null)
                || await usersFindByEmail(email);

            if (existingUser) {
                return res.status(400).json({ error: 'User already exists with this email' });
            }

            const now = new Date();
            const user = {
                _id: docId,
                firebaseUid: firebaseUid || null,
                email,
                name,
                phone,
                profilePicture: profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=BDA6CE&color=fff`,
                emergencyContacts: [],
                safetyPreferences: defaultPreferences(),
                statistics: defaultStats(),
                isActive: true,
                role: 'user',
                createdAt: now,
                updatedAt: now,
            };

            await usersCreate(user);

            res.json({
                success: true,
                message: 'User registered successfully',
                user: { _id: user._id, email: user.email, name: user.name, phone: user.phone, profilePicture: user.profilePicture },
            });
        } catch (error) {
            console.error('Error registering user:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to register user',
            });
        }
    }
);

/**
 * @route   GET /api/users/profile/:userId
 * @desc    Get user profile (userId = Firebase UID in production)
 * @access  Private
 */
router.get('/profile/:userId', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, user });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch user profile',
        });
    }
});

/**
 * @route   PUT /api/users/profile/:userId
 * @desc    Update user profile fields (userId = Firebase UID)
 * @access  Private
 */
router.put(
    '/profile/:userId',
    [
        body('name').optional().trim(),
        body('phone').optional().trim(),
        body('profilePicture').optional(),
        body('age').optional().trim(),
        body('homeAddress').optional().trim(),
        body('bloodGroup').optional().trim(),
        body('allergies').optional().trim(),
        body('medications').optional().trim(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }

            const { name, phone, profilePicture, safetyPreferences, age, homeAddress, bloodGroup, allergies, medications } = req.body;

            const user = await usersFindById(req.params.userId);
            if (!user) return res.status(404).json({ error: 'User not found' });

            if (name) user.name = name;
            if (phone !== undefined) user.phone = phone;
            if (profilePicture !== undefined && profilePicture !== '') user.profilePicture = profilePicture;
            if (age !== undefined) user.age = age;
            if (homeAddress !== undefined) user.homeAddress = homeAddress;
            if (bloodGroup !== undefined) user.bloodGroup = bloodGroup;
            if (allergies !== undefined) user.allergies = allergies;
            if (medications !== undefined) user.medications = medications;
            if (safetyPreferences) user.safetyPreferences = { ...user.safetyPreferences, ...safetyPreferences };
            user.updatedAt = new Date();
            await usersSave(user);

            res.json({ success: true, message: 'Profile updated successfully', user });
        } catch (error) {
            console.error('Error updating profile:', error);
            const status = error.statusCode || 500;
            res.status(status).json({
                error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to update profile',
            });
        }
    }
);

/**
 * @route   GET /api/users/stats/:userId
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/stats/:userId', async (req, res) => {
    try {
        const user = await usersFindById(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, statistics: user.statistics });
    } catch (error) {
        console.error('Error fetching user stats:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to fetch user statistics',
        });
    }
});

/**
 * @route   GET /api/users/email/:email
 * @desc    Find user by email (legacy lookup)
 * @access  Public
 */
router.get('/email/:email', async (req, res) => {
    try {
        const user = await usersFindByEmail(req.params.email);
        if (!user) return res.json({ success: true, exists: false });

        res.json({
            success: true,
            exists: true,
            user: { _id: user._id, email: user.email, name: user.name, profilePicture: user.profilePicture },
        });
    } catch (error) {
        console.error('Error finding user by email:', error);
        const status = error.statusCode || 500;
        res.status(status).json({
            error: error.code === 'FIRESTORE_NOT_CONFIGURED' ? error.message : 'Failed to find user',
        });
    }
});

module.exports = router;
