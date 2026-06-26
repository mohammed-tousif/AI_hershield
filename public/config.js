/**
 * HerShield — API Environment Config
 *
 * Load this script FIRST on every page (before navigation.js and any code
 * that calls fetch('/api/...')).
 *
 * What it does:
 *  • On localhost         → no-op; relative /api/ URLs reach the local server
 *  • On Firebase Hosting  → installs a transparent fetch + XHR interceptor that
 *                           rewrites /api/… to the Render backend URL, so every
 *                           existing fetch('/api/…') call works without changes.
 *
 * Socket.IO (dashboard.html, safety-map.html) reads window.HERSHIELD_BACKEND
 * to connect to the correct server.
 */
(function () {
    'use strict';

    // ── Environment detection ─────────────────────────────────────────────────
    var host    = window.location.hostname;
    var isLocal = (host === 'localhost' || host === '127.0.0.1');

    /** Render backend root — update if your Render service URL ever changes */
    var RENDER_BACKEND = 'https://hershield-api.onrender.com';

    /**
     * Exposed globally so Socket.IO connections can use it:
     *   io(window.HERSHIELD_BACKEND || location.origin, { transports:['polling'] })
     */
    window.HERSHIELD_BACKEND = isLocal ? '' : RENDER_BACKEND;

    // In local dev there is nothing to intercept
    if (isLocal) return;

    // ── Fetch interceptor ─────────────────────────────────────────────────────
    var _fetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        if (typeof input === 'string' && input.startsWith('/api/')) {
            input = RENDER_BACKEND + input;
        } else if (typeof input === 'string' && input.startsWith('/socket.io/')) {
            input = RENDER_BACKEND + input;
        } else if (input instanceof Request) {
            var url = input.url;
            if (url.startsWith('/api/') || url.startsWith('/socket.io/')) {
                input = new Request(RENDER_BACKEND + url, input);
            }
        }
        return _fetch(input, init);
    };

    // ── XHR interceptor (legacy fallback) ────────────────────────────────────
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('/socket.io/'))) {
            url = RENDER_BACKEND + url;
        }
        return _open.apply(this, arguments.length > 2
            ? [method, url].concat(Array.prototype.slice.call(arguments, 2))
            : [method, url]);
    };

    console.info('[HerShield] Production mode: API → ' + RENDER_BACKEND);
})();
