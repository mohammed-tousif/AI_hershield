/**
 * Same app as ../server.js but runnable as: node public/server.js
 * Resolves project root so config, routes, and static files match the main server.
 */
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
const { getFirestoreAdmin } = require('../config/firestoreAdmin');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { connectDB, checkDBHealth } = require('../config/database');
const { listenWithFallback } = require('../config/listenWithFallback');

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

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};

const io = socketIo(server, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
});

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    })
);
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

app.use(express.static(PROJECT_ROOT));

connectDB();

const emergencyRoutes = require('../routes/emergencyLite');
const trackingRoutes = require('../routes/trackingLite');
const safetyRoutes = require('../routes/safety');
const safetyLocationsRoutes = require('../routes/safetyLocations');
const usersRoutes = require('../routes/users');
const communityRoutes = require('../routes/community');

app.use('/api/emergency', emergencyRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/safety', safetyLocationsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/live-tracker', require('../routes/liveTracker'));
app.use('/api/community', communityRoutes);

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

const activeSessions = new Map();

io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    socket.on('joinSession', (sessionId) => {
        socket.join(sessionId);
        if (!activeSessions.has(sessionId)) {
            activeSessions.set(sessionId, new Set());
        }
        activeSessions.get(sessionId).add(socket.id);
        console.log(`📍 Socket ${socket.id} joined session: ${sessionId}`);
        console.log(`👥 Active viewers in session ${sessionId}: ${activeSessions.get(sessionId).size}`);
        socket.to(sessionId).emit('viewerJoined', {
            viewerCount: activeSessions.get(sessionId).size,
        });
    });

    socket.on('locationUpdate', (data) => {
        const { sessionId, location } = data;
        if (!sessionId || !location) {
            socket.emit('error', { message: 'Invalid location update data' });
            return;
        }
        io.to(sessionId).emit('locationUpdated', {
            location,
            timestamp: new Date(),
        });
        console.log(`📍 Location updated for session ${sessionId}`);
    });

    socket.on('emergency', (data) => {
        const { sessionId, location } = data;
        console.log(`🚨 Emergency triggered for session: ${sessionId}`);
        io.to(sessionId).emit('emergencyDeclared', {
            sessionId,
            location,
            timestamp: new Date(),
        });
    });

    socket.on('checkIn', (data) => {
        const { sessionId, location, message } = data;
        io.to(sessionId).emit('checkInReceived', {
            location,
            message,
            timestamp: new Date(),
        });
        console.log(`✅ Check-in received for session ${sessionId}`);
    });

    socket.on('endSession', (sessionId) => {
        io.to(sessionId).emit('sessionEnded', {
            sessionId,
            timestamp: new Date(),
        });
        console.log(`🏁 Session ended: ${sessionId}`);
    });

    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        activeSessions.forEach((viewers, sessionId) => {
            if (viewers.has(socket.id)) {
                viewers.delete(socket.id);
                io.to(sessionId).emit('viewerLeft', {
                    viewerCount: viewers.size,
                });
                if (viewers.size === 0) {
                    activeSessions.delete(sessionId);
                }
            }
        });
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    const errorMessage = process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message;
    res.status(err.status || 500).json({
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.path,
    });
});

listenWithFallback(server, (port) => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🛡️  Her Shield — AI-powered Women Safety System (public/server.js)');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`🚀 Server running on: http://localhost:${port}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    const fsDb = getFirestoreAdmin();
    console.log(fsDb ? '🔥 Firestore Admin: ready (server-side)' : 'ℹ️  Firestore Admin: not configured');
    if (!fsDb) {
        console.log(
            '⚠️  Without Firestore: set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON — see .env.example.'
        );
    }
    console.log('');
    console.log('📡 Available API Endpoints:');
    console.log('   GET  /api/health                    - Health check');
    console.log('   POST /api/emergency/trigger         - Trigger SOS alert');
    console.log('   POST /api/live-tracker/start        - Live tracker session');
    console.log('   POST /api/safety/report             - Report incident (Firestore)');
    console.log('   POST /api/safety/report-full        - Full incident report');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
});

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
