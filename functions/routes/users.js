const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

/**
 * @route   POST /api/users/register
 * @desc    Register new user
 * @access  Public
 */
router.post('/register', [
    body('email').isEmail().normalizeEmail(),
    body('name').notEmpty().trim(),
    body('phone').optional().trim(),
    body('firebaseUid').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, name, phone, firebaseUid, profilePicture } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        // Create new user
        const user = new User({
            email,
            name,
            phone,
            firebaseUid,
            profilePicture: profilePicture || 'https://i.pravatar.cc/150?img=32'
        });

        await user.save();

        res.json({
            success: true,
            message: 'User registered successfully',
            user: {
                _id: user._id,
                email: user.email,
                name: user.name,
                phone: user.phone,
                profilePicture: user.profilePicture
            }
        });

    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Failed to register user' });
    }
});

/**
 * @route   GET /api/users/profile/:userId
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('-__v');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            user
        });

    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

/**
 * @route   PUT /api/users/profile/:userId
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile/:userId', [
    body('name').optional().trim(),
    body('phone').optional().trim(),
    body('profilePicture').optional()
], async (req, res) => {
    try {
        const { name, phone, profilePicture, safetyPreferences } = req.body;

        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update fields
        if (name) user.name = name;
        if (phone) user.phone = phone;
        if (profilePicture) user.profilePicture = profilePicture;
        if (safetyPreferences) {
            user.safetyPreferences = { ...user.safetyPreferences, ...safetyPreferences };
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user
        });

    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * @route   GET /api/users/stats/:userId
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/stats/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            statistics: user.statistics
        });

    } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

/**
 * @route   GET /api/users/email/:email
 * @desc    Find user by email (for Firebase integration)
 * @access  Public
 */
router.get('/email/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email });

        if (!user) {
            return res.json({
                success: true,
                exists: false
            });
        }

        res.json({
            success: true,
            exists: true,
            user: {
                _id: user._id,
                email: user.email,
                name: user.name,
                profilePicture: user.profilePicture
            }
        });

    } catch (error) {
        console.error('Error finding user by email:', error);
        res.status(500).json({ error: 'Failed to find user' });
    }
});

module.exports = router;
