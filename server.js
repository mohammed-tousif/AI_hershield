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
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Socket.IO setup
const io = socketIo(server, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000
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

// Logging
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve static files from the project root (always use __dirname, not '.')
app.use(express.static(__dirname));
// Uploaded community images (created by multer)
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

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

// Admin-specific strict rate limiter (20 req / min)
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too many admin requests',
    standardHeaders: true,
    legacyHeaders: false,
});

// API Routes
app.use('/api/emergency', emergencyRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/safety', safetyLocationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/live-tracker', require('./routes/liveTracker'));
app.use('/api/community', communityRoutes);
app.use('/api/admin',    adminLimiter, adminRoutes);
app.use('/api/legal',    require('./routes/legalChat'));   // 🛡️ LexaShield legal chatbot

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

// Health check endpoint
app.get('/api/health', (req, res) => {
    const dbHealth = checkDBHealth();
    const fsReady = !!getFirestoreAdmin();
    const warnings = [];
    if (!fsReady) {
        warnings.push(
            'Firestore Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH (key file) or FIREBASE_SERVICE_ACCOUNT_JSON — see .env.example.'
        );
    }
    res.json({
        status: 'ok',
        timestamp: new Date(),
        database: dbHealth,
        port: typeof global.__HER_SHIELD_HTTP_PORT__ === 'number' ? global.__HER_SHIELD_HTTP_PORT__ : null,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        ...(warnings.length ? { warnings } : {}),
    });
});

// Socket.IO connection handling
const activeSessions = new Map(); // sessionId -> Set of socket IDs

io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // Join tracking session room
    socket.on('joinSession', (sessionId) => {
        socket.join(sessionId);

        // Track active connections per session
        if (!activeSessions.has(sessionId)) {
            activeSessions.set(sessionId, new Set());
        }
        activeSessions.get(sessionId).add(socket.id);

        console.log(`📍 Socket ${socket.id} joined session: ${sessionId}`);
        console.log(`👥 Active viewers in session ${sessionId}: ${activeSessions.get(sessionId).size}`);

        // Notify others in the room
        socket.to(sessionId).emit('viewerJoined', {
            viewerCount: activeSessions.get(sessionId).size
        });
    });

    // Handle location updates
    socket.on('locationUpdate', (data) => {
        const { sessionId, location } = data;

        if (!sessionId || !location) {
            socket.emit('error', { message: 'Invalid location update data' });
            return;
        }

        // Broadcast location to all clients in the session room
        io.to(sessionId).emit('locationUpdated', {
            location,
            timestamp: new Date()
        });

        console.log(`📍 Location updated for session ${sessionId}`);
    });

    // Handle emergency alerts
    socket.on('emergency', (data) => {
        const { sessionId, location } = data;

        console.log(`🚨 Emergency triggered for session: ${sessionId}`);

        // Broadcast emergency to all clients in the session
        io.to(sessionId).emit('emergencyDeclared', {
            sessionId,
            location,
            timestamp: new Date()
        });
    });

    // Handle check-ins
    socket.on('checkIn', (data) => {
        const { sessionId, location, message } = data;

        io.to(sessionId).emit('checkInReceived', {
            location,
            message,
            timestamp: new Date()
        });

        console.log(`✅ Check-in received for session ${sessionId}`);
    });

    // Handle session end
    socket.on('endSession', (sessionId) => {
        io.to(sessionId).emit('sessionEnded', {
            sessionId,
            timestamp: new Date()
        });

        console.log(`🏁 Session ended: ${sessionId}`);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);

        // Remove from active sessions
        activeSessions.forEach((viewers, sessionId) => {
            if (viewers.has(socket.id)) {
                viewers.delete(socket.id);

                // Notify remaining viewers
                io.to(sessionId).emit('viewerLeft', {
                    viewerCount: viewers.size
                });

                // Clean up empty sessions
                if (viewers.size === 0) {
                    activeSessions.delete(sessionId);
                }
            }
        });
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

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
