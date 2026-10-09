const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getFirestoreAdmin } = require('./config/firestoreAdmin');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { connectDB, checkDBHealth } = require('./config/database');
const { listenWithFallback } = require('./config/listenWithFallback');

// Initialize Express app
const app = express();
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}
const server = http.createServer(app);

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    if (process.env.NODE_ENV === 'production') process.exit(1);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    if (process.env.NODE_ENV === 'production') process.exit(1);
});

// CORS configuration
const corsOptions = {
    origin(origin, callback) {
        const allowed = new Set([process.env.FRONTEND_URL, process.env.APP_URL, 'https://hershield-web.web.app', 'https://hershield-web.firebaseapp.com'].filter(Boolean).map(value => new URL(value).origin));
        if (!origin || allowed.has(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false
};

// Socket.IO setup — force polling only so it works through Firebase Hosting's HTTPS proxy
// WebSocket transport fails because Firebase Hosting cannot upgrade HTTP→WS connections
const io = socketIo(server, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['polling'],
    allowEIO3: true
});
app.set('io', io); // expose to routes

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for development, enable in production
    crossOriginEmbedderPolicy: false
}));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Never retain location-sharing capabilities in access logs.
morgan.token('url', req => req.originalUrl.replace(/(\/view\/|\/lookup-code\/|\/code\/)[^/?]+/gi, '$1[redacted]').split('?')[0]);
// Logging
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Rate limiting
// NOTE: `message` must be a JSON-serializable value, not a plain string —
// express-rate-limit sends it as the response body as-is on 429, and every
// fetch() call across this app's frontend does response.json() unconditionally.
// A plain string body isn't valid JSON, so JSON.parse would throw
// `Unexpected token 'T', "Too many r"... is not valid JSON` — a real bug users
// hit (every panel on the admin dashboard showing that exact parse error
// whenever the limit tripped, instead of a readable rate-limit message).
//
// This general limiter used to sit in front of EVERY /api/* route, including
// /api/admin (which also has its own adminLimiter below — so admin traffic
// was being throttled by the STRICTER of the two, making the adminLimiter
// tuning further down a no-op) and /api/emergency + /api/live-tracker, whose
// own polling (an active SOS session's GPS updates, live-tracker's
// navigator.geolocation.watchPosition with no debounce) can alone generate
// 100+ requests within 15 minutes — meaning a real emergency session could
// get silently throttled. Both were confirmed by tracing actual polling
// intervals across dashboard.html/live-tracker.html/navigation.js. Passive
// dashboard background polling alone (recent alerts every 15s, SOS/tracking
// history every 30s) was already landing near the old 100/15min ceiling with
// a single tab open, before counting any real interaction.
//
// Fix: raise the ceiling substantially, and exclude /api/admin (has its own
// limiter), /api/emergency and /api/live-tracker (safety-critical — see
// emergencyLimiter below for their dedicated, much higher-frequency-tolerant
// limit instead of a blanket exemption).
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
    message: { success: false, message: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // req.path here is relative to this middleware's /api/ mount point (e.g.
    // "/admin/stats", not "/api/admin/stats") — use req.originalUrl instead,
    // which always reflects the full incoming path regardless of mounting.
    skip: (req) => (
        req.originalUrl.startsWith('/api/admin') ||
        req.originalUrl.startsWith('/api/emergency') ||
        req.originalUrl.startsWith('/api/live-tracker')
    ),
});
app.use('/api/', limiter);

// Safety-critical endpoints get their own generous, per-minute limiter instead
// of the general one — an active SOS/live-tracking session can legitimately
// send a location update every few seconds, and must never be silently
// dropped by a request-count ceiling. This still bounds outright abuse/flooding
// (300/min = 5/sec sustained, far above any real GPS reporting rate) without
// risking a real emergency's location updates being throttled.
const emergencyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { success: false, message: 'Too many requests — please wait a moment and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Explicit public assets only; source, credentials and data are never static files.
app.use(require('./middleware/publicAssets').publicAssets(__dirname));
// Uploaded community images (created by multer)
// Historical uploads/data are intentionally not served. Current images use Cloudinary.

// Root route → landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

connectDB();

// Import routes
const emergencyRoutes = require('./routes/emergencyLite');
const trackingRoutes = require('./routes/trackingLite');
const safetyRoutes = require('./routes/safety');
const safetyLocationsRoutes = require('./routes/safetyLocations');
const usersRoutes = require('./routes/users');
const communityRoutes = require('./routes/community');
const adminRoutes     = require('./routes/admin');

// Admin-specific rate limiter. Raised 20 → 60 → 120/min: Overview's 30s
// auto-refresh alone fires ~6 requests/cycle (stats, verifications, logs,
// users, sos, incidents — needed for the trend charts), i.e. ~12/min just
// from having that tab open, which left too little headroom at 60/min for
// real admin activity (multiple tabs open, quick clicking between
// sections, exports) — users were occasionally hitting the ceiling during
// normal use. Still a real ceiling — this is a single authenticated admin,
// not a public endpoint, so generous throttling here is about basic abuse
// protection, not user-facing rate limiting. `message` must be JSON, not a
// plain string — see the comment on `limiter` above for why.
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { success: false, message: 'Too many admin requests. Please wait a moment and try again.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Central deny-by-default API identity/ownership boundary.
app.use('/api', require('./middleware/apiAccess').apiAccess);

// API Routes
app.use('/api/emergency', emergencyLimiter, emergencyRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/safety', safetyLocationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/email-verification', require('./routes/emailVerification'));
app.use('/api/live-tracker', emergencyLimiter, require('./routes/liveTracker'));
app.use('/api/community', communityRoutes);
app.use('/api/admin',    adminLimiter, adminRoutes);
app.use('/api/legal',    require('./routes/legalChat'));   // 🛡️ LexaShield legal chatbot
app.use('/api/verification', require('./routes/verification')); // gender verification: self-declaration + selfie + admin review

// ── Re-hydrate SOS timers on startup ────────────────────────────────────────
// If the server restarts while users have active SOS sessions, we reschedule
// the auto-expiry timers so they still fire correctly.
(async () => {
    try {
        const fs = getFirestoreAdmin();
        if (!fs) return;
        const snap = await fs.collection('hershield_sos_events').where('status', '==', 'active').get();
        if (snap.empty) return;
        snap.docs.forEach((doc) => {
            const data = doc.data();
            const expiresAt = data.expiresAt && typeof data.expiresAt.toDate === 'function'
                ? data.expiresAt.toDate().toISOString()
                : data.expiresAt;
            if (expiresAt) {
                emergencyRoutes.scheduleSosTimer(data.userId, doc.id, expiresAt);
                console.log(`⏰ Re-hydrated SOS timer for userId=${data.userId}, expires ${expiresAt}`);
            }
        });
    } catch (e) {
        console.warn('SOS timer re-hydration skipped:', e.message);
    }
})();

// ── Gender-verification selfie retention sweep ──────────────────────────────
// Deletes verification selfies (routes/verification.js) 90 days after
// submission, regardless of outcome — runs once at startup, then daily.
const { purgeExpiredVerificationSelfies, RETENTION_DAYS } = require('./services/verificationRetention');
const VERIFICATION_RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000; // once a day
purgeExpiredVerificationSelfies().then((n) => {
    if (n > 0) console.log(`🗑️  Verification retention sweep (startup): purged ${n} selfie(s) older than ${RETENTION_DAYS} days`);
});
setInterval(purgeExpiredVerificationSelfies, VERIFICATION_RETENTION_SWEEP_MS);

// Health check endpoint
app.get('/api/health', (req, res) => {
    const dbHealth = checkDBHealth();
    const fsReady = !!getFirestoreAdmin();
    // Email now sends via the Gmail REST API (HTTPS), not SMTP — see services/emailService.js.
    const { isConfigured: isEmailConfigured } = require('./services/emailService');
    const emailConfigured = isEmailConfigured();
    const warnings = [];
    if (!fsReady) {
        warnings.push(
            'Firestore Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (key file) or FIREBASE_SERVICE_ACCOUNT_JSON — see .env.example.'
        );
    }
    if (!emailConfigured) {
        warnings.push('Email is not configured. Set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN and EMAIL_USER — see .env.example.');
    }
    res.json({
        status: 'ok',
        timestamp: new Date(),
        database: dbHealth,
        email: { configured: emailConfigured },
        frontendUrl: process.env.FRONTEND_URL || null,
        appUrl: process.env.APP_URL || null,
        port: typeof global.__HER_SHIELD_HTTP_PORT__ === 'number' ? global.__HER_SHIELD_HTTP_PORT__ : null,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        ...(warnings.length ? { warnings } : {}),
    });
});

// Dashboard stats — real-time counts from Firestore
app.get('/api/dashboard/stats', async (req, res) => {
    const TIMEOUT_MS = 6000;
    let timer;
    try {
        const { getDashboardStats } = require('./services/firestoreRepository');
        const timeoutP = new Promise(resolve =>
            timer = setTimeout(() => resolve({ _timedOut: true }), TIMEOUT_MS)
        );
        const result = await Promise.race([getDashboardStats(), timeoutP]);
        if (result && result._timedOut) {
            return res.status(503).json({ success: false, message: 'Statistics are temporarily unavailable. Please retry.' });
        }
        return res.json({ success: true, stats: result });
    } catch (err) {
        console.warn('/api/dashboard/stats error:', err.message);
        return res.status(503).json({ success: false, message: 'Statistics are temporarily unavailable. Please retry.' });
    } finally { clearTimeout(timer); }
});

require('./services/socketAccess').installSocketAccess(io);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // Don't leak error details in production
    const errorMessage = process.env.NODE_ENV === 'production'
        ? 'An error occurred'
        : err.message;

    res.status(err.status || 500).json({
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.path
    });
});

listenWithFallback(server, (port) => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🛡️  Her Shield — AI-powered Women Safety System');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🚀 Server running on: http://localhost:${port}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    const fsDb = getFirestoreAdmin();
    console.log(fsDb ? '🔥 Firestore Admin: ready (server-side)' : 'ℹ️  Firestore Admin: not configured');
    if (!fsDb) {
        console.log(
            '⚠️  Without Firestore: set FIREBASE_SERVICE_ACCOUNT_PATH (local .json) or FIREBASE_SERVICE_ACCOUNT_JSON (e.g. Render). See .env.example.'
        );
    }
    console.log('');
    console.log('📡 Available API Endpoints:');
    console.log('   GET  /api/health                         - Health check');
    console.log('   POST /api/emergency/sos/start            - 🆕 Start SOS with live tracking + PIN');
    console.log('   POST /api/emergency/sos/safe             - 🆕 Mark user safe (PIN required)');
    console.log('   GET  /api/emergency/sos/active/:userId   - 🆕 Check active SOS session');
    console.log('   GET  /api/emergency/sos/history/:userId  - 🆕 SOS history (private)');
    console.log('   POST /api/emergency/trigger              - Trigger legacy SOS alert');
    console.log('   POST /api/emergency/contacts             - Add emergency contact');
    console.log('   POST /api/tracking/start                - Start tracking session');
    console.log('   POST /api/tracking/location             - Update location');
    console.log('   POST /api/tracking/end                  - End tracking session');
    console.log('   GET  /api/safety/heatmap                - Get safety heatmap');
    console.log('   POST /api/safety/route                  - Calculate route safety');
    console.log('   POST /api/safety/report                 - Report incident (Firestore)');
    console.log('   POST /api/safety/report-full            - Full incident report + user stats');
    console.log('   POST /api/users/register                - Register user');
    console.log('   GET  /api/users/profile/:userId         - Get user profile');
    console.log('');
    console.log('🔌 Socket.IO Events:');
    console.log('   joinSession      - Join tracking session');
    console.log('   locationUpdate   - Send location update');
    console.log('   emergency        - Trigger emergency');
    console.log('   checkIn          - Send check-in');
    console.log('   endSession       - End tracking session');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

module.exports = { app, server, io };
