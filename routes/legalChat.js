'use strict';

/**
 * routes/legalChat.js
 * --------------------
 * API routes for the LexaShield AI legal guidance chatbot.
 *
 * Routes:
 *   POST /api/legal/chat    — main chat endpoint
 *   GET  /api/legal/topics  — quick-start topic chips for the UI
 *   GET  /api/legal/health  — service health check (internal)
 */

const express        = require('express');
const router         = express.Router();
const rateLimit      = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const legalChatSvc   = require('../services/legalChatService');

// ── Rate limiter (separate, stricter than global) ─────────────────────────────
// 20 messages per 10 minutes per IP — prevents abuse while allowing natural conversation
const chatLimiter = rateLimit({
    windowMs:        parseInt(process.env.GROQ_LEGAL_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
    max:             parseInt(process.env.GROQ_LEGAL_RATE_LIMIT_MAX,        10) || 20,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    (req) => req.ip || 'unknown',
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            error:   'Too many requests. Please wait a few minutes before sending another message.',
            code:    'RATE_LIMIT_EXCEEDED',
        });
    },
});

// ── Validation rules ──────────────────────────────────────────────────────────
const chatValidators = [
    body('message')
        .trim()
        .notEmpty().withMessage('Message is required.')
        .isLength({ min: 2, max: 2000 }).withMessage('Message must be between 2 and 2000 characters.'),

    body('history')
        .optional()
        .isArray({ max: 20 }).withMessage('History must be an array with at most 20 entries.'),

    body('history.*.role')
        .optional()
        .isIn(['user', 'assistant']).withMessage('History role must be "user" or "assistant".'),

    body('history.*.content')
        .optional()
        .isString()
        .isLength({ max: 3000 }).withMessage('History message too long.'),

    // { nullable: true } is required here, not just .optional() — the frontend
    // always sends this field, using `null` (not omitting it) to mean "no topic
    // selected" for a normal typed message. express-validator's .optional() by
    // default only skips truly-missing (undefined) fields, not explicit null,
    // so a plain message like "Hi" was failing .isString() on the null value
    // and getting rejected with the generic "Invalid value" error — while topic
    // chips (which send a real string like "harassment") worked fine.
    body('incidentContext')
        .optional({ nullable: true })
        .isString()
        .isLength({ max: 100 })
        .matches(/^[a-z_]+$/).withMessage('Invalid incident context format.'),
];

// ── POST /api/legal/chat ───────────────────────────────────────────────────────
/**
 * Body: { message: string, history?: [{role, content}][], incidentContext?: string }
 * Response: { success: true, reply: string, model: string, tokensUsed: number }
 */
router.post('/chat', chatLimiter, chatValidators, async (req, res) => {
    // Validation check
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error:   errors.array()[0].msg,
            details: errors.array(),
        });
    }

    const { message, history = [], incidentContext = null } = req.body;

    try {
        const result = await legalChatSvc.chat(message, history, incidentContext);

        return res.json({
            success:    true,
            reply:      result.content,
            model:      result.model,
            tokensUsed: result.tokensUsed,
        });
    } catch (err) {
        console.error('[LegalChat] Groq API error:', err.message);

        // Groq-specific error codes
        if (err.status === 429 || err.message?.includes('rate limit')) {
            return res.status(429).json({
                success: false,
                error:   'The AI service is currently busy. Please try again in a moment.',
                code:    'AI_RATE_LIMIT',
            });
        }
        if (err.message?.includes('GROQ_API_KEY')) {
            return res.status(503).json({
                success: false,
                error:   'Legal AI service is not configured. Contact support.',
                code:    'AI_NOT_CONFIGURED',
            });
        }

        return res.status(500).json({
            success: false,
            error:   'The legal assistant is temporarily unavailable. Please try again.',
            code:    'AI_ERROR',
        });
    }
});

// ── GET /api/legal/topics ─────────────────────────────────────────────────────
/**
 * Returns the list of quick-start topic chips shown in the chat UI.
 * No auth required, no rate limit — static data.
 */
router.get('/topics', (req, res) => {
    res.json({
        success: true,
        topics:  legalChatSvc.getTopics(),
    });
});

// ── GET /api/legal/health ─────────────────────────────────────────────────────
/**
 * Internal health check — verifies Groq connectivity.
 * Should only be called from monitoring tools, not the UI.
 */
router.get('/health', async (req, res) => {
    try {
        const result = await legalChatSvc.healthCheck();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(503).json({ success: false, error: err.message });
    }
});

module.exports = router;
