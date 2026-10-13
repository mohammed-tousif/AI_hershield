'use strict';
const { findSharedSession, viewerLocation, endViewers } = require('./trackingSecurity');
const hub = require('./liveLocationHub');
function installSocketAccess(io) {
    // Public feed broadcasts are read-only. Tracking rooms require a live share capability.
    io.on('connection', socket => {
        let joined = null;
        let lastJoin = 0;
        socket.on('joinSession', async (request, acknowledge = () => {}) => {
            const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
            if (Date.now() - lastJoin < 1000) return reply({ success: false });
            lastJoin = Date.now();
            try {
                const code = request && typeof request === 'object' ? request.code : null;
                const s = await findSharedSession(code);
                if (!s) return reply({ success: false, message: 'Invalid or expired share link.' });
                if (joined) await socket.leave('tracking:' + joined.id);
                joined = { code, id: s._id || s.userId };
                await socket.join('tracking:' + joined.id);
                // Hand over the current position immediately instead of making the
                // guardian wait for the sender's next update.
                reply({ success: true, location: viewerLocation(s, hub.snapshot(joined.id, s.trackingCode)) });
            } catch { reply({ success: false, message: 'Tracking unavailable.' }); }
        });
        // Clients cannot publish location, emergency or end events. Authenticated REST
        // writes are the sole source of these events.
        const timer = setInterval(async () => {
            if (!joined) return;
            try {
                if (!await findSharedSession(joined.code)) {
                    socket.emit('sessionEnded', { sessionId: joined.id });
                    await socket.leave('tracking:' + joined.id); joined = null;
                }
            } catch { socket.emit('trackingUnavailable'); }
        }, 15000);
        timer.unref?.();
        socket.on('disconnect', () => clearInterval(timer));
    });
}
module.exports = { installSocketAccess, endViewers };
