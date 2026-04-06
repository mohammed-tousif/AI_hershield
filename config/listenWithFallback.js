'use strict';

/**
 * Bind HTTP server with automatic port fallback when EADDRINUSE (common on Windows dev).
 * Set PORT (base) and optional PORT_RANGE (default 25) — tries base, base+1, …
 *
 * Important: On some platforms, calling server.listen() again after EADDRINUSE without
 * server.close() can leave duplicate success callbacks or wrong ports. We always
 * close before retrying and use the `listening` event + server.address().port.
 */
function listenWithFallback(server, onReady) {
    const base = parseInt(process.env.PORT, 10);
    const startPort = Number.isFinite(base) && base > 0 ? base : 3000;
    const range = parseInt(process.env.PORT_RANGE, 10);
    const maxPort = startPort + (Number.isFinite(range) && range > 0 ? range : 25);

    let bound = false;

    function tryPort(port) {
        if (port >= maxPort) {
            console.error(
                `❌ No free port between ${startPort} and ${maxPort - 1}. Stop other Node processes or set PORT in .env`
            );
            process.exit(1);
            return;
        }

        const detach = () => {
            server.removeListener('error', onListenErr);
            server.removeListener('listening', onListenOk);
        };

        const onListenOk = () => {
            detach();
            if (bound) return;
            bound = true;
            const addr = server.address();
            const actualPort = addr && typeof addr.port === 'number' ? addr.port : port;
            global.__HER_SHIELD_HTTP_PORT__ = actualPort;
            process.env.ACTIVE_PORT = String(actualPort);
            if (!process.env.APP_URL || !String(process.env.APP_URL).trim()) {
                process.env.APP_URL = `http://localhost:${actualPort}`;
            }
            onReady(actualPort);
        };

        const onListenErr = (err) => {
            detach();
            if (err.code === 'EADDRINUSE') {
                const next = port + 1;
                console.warn(`⚠️  Port ${port} is already in use — trying ${next}…`);
                const goNext = () => tryPort(next);
                try {
                    server.close(goNext);
                } catch {
                    goNext();
                }
                return;
            }
            console.error('❌ Server could not listen:', err.message);
            process.exit(1);
        };

        server.once('error', onListenErr);
        server.once('listening', onListenOk);
        // Bind without forcing IPv4 so localhost can resolve cleanly on both IPv4 and IPv6.
        server.listen(port);
    }

    tryPort(startPort);
}

module.exports = { listenWithFallback };
