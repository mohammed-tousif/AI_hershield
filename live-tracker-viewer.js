/**
 * Read-only, expiring share-link viewer. No login or private profile access.
 *
 * Real time: the server pushes every fix (with coordinates) over Socket.IO to
 * sockets that joined with a valid share code. REST polling is the backstop
 * (fast when the socket is down) and the authority on expiry/revocation.
 * Freshness is measured against the server clock, so a guardian device with a
 * wrong clock can't make a live location look stale (or a stale one live).
 */
(() => {
    'use strict';
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('track')) return;
    const code = params.get('code');

    const LIVE_MS = 20000;          // a fix newer than this is "live" (sender heartbeat is 10s)
    const OFFLINE_MS = 60000;       // beyond this the sender is probably offline / locked
    const GUARDIAN_LOST_MS = 25000; // we ourselves haven't heard from the server
    const POLL_SOCKET_MS = 15000;   // backstop while the socket is delivering
    const POLL_FALLBACK_MS = 3000;  // no socket: poll fast so it still feels live
    const TRAIL_MAX = 300;

    // White status text stays at >= 4.5:1 contrast on each of these.
    const COLORS = { live: '#1e7e34', warn: '#8a5300', bad: '#b02a37', idle: '#5c636a' };

    /** Same-origin-with-the-API client, so its version always matches the server. */
    function loadSocketClient() {
        if (window.io) return Promise.resolve(window.io);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = (window.HERSHIELD_BACKEND || location.origin) + '/socket.io/socket.io.js';
            script.async = true;
            script.onload = () => (window.io ? resolve(window.io) : reject(new Error('Socket client missing')));
            script.onerror = () => reject(new Error('Socket client unavailable'));
            document.head.appendChild(script);
        });
    }

    // Loaded with `async`, so start as soon as <body> exists — never wait on
    // DOMContentLoaded, which waits for every other (possibly slow CDN) script.
    function init() {
        const shell = document.createElement('section');
        shell.id = 'viewerMode';
        shell.style.cssText = 'position:fixed;inset:0;z-index:210000;background:#fff8f2;display:grid;grid-template-rows:auto auto minmax(0,1fr);font-family:system-ui;';
        shell.innerHTML =
            '<header style="padding:14px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#713c32;color:white">' +
                '<strong>HerShield · Shared journey</strong>' +
                '<span id="viewerStatusText" role="status" aria-live="polite" style="padding:3px 10px;border-radius:999px;background:#6c757d;font-size:.9rem">Connecting…</span>' +
            '</header>' +
            '<div style="padding:10px 16px;display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center;font-size:.95rem">' +
                '<span id="viewerDetail" style="flex-basis:100%;color:#5a4a44"></span>' +
                '<span id="viewerCoords">Waiting for location</span>' +
                '<span id="viewerLastUpdate" style="color:#5a4a44"></span>' +
                '<a id="viewerOpenMaps" target="_blank" rel="noopener noreferrer" hidden>Open in Maps</a>' +
                '<button id="viewerRecenter" type="button" hidden style="border:1px solid #713c32;background:white;color:#713c32;border-radius:999px;padding:2px 12px">Re-center on sender</button>' +
            '</div>' +
            '<div style="position:relative;min-height:0">' +
                '<div id="viewerMap" style="position:absolute;inset:0"></div>' +
                '<p id="viewerWaitingMsg" style="position:relative;background:#fff;padding:16px;margin:12px">Connecting to the journey…</p>' +
            '</div>';
        document.body.appendChild(shell);

        const $ = id => document.getElementById(id);
        const statusEl = $('viewerStatusText'), detailEl = $('viewerDetail'), message = $('viewerWaitingMsg');

        let ended = false, socket = null, joined = false;
        let pollTimer = null, polling = false, repoll = false;
        let renderTimer = null, mapRetry = null;
        let map = null, marker = null, accuracyCircle = null, trail = null, follow = true;
        let last = null;          // { lat, lng, accuracy, fixTime }  (fixTime on the server clock)
        let clockOffset = 0;      // serverNow - Date.now()
        let senderState = null, senderStateAt = 0, senderSeenAt = 0;
        let lastServerContact = 0;
        const trailPoints = [];

        const serverNow = () => Date.now() + clockOffset;
        function ago(ms) {
            const s = Math.max(0, Math.round(ms / 1000));
            if (s < 5) return 'just now';
            if (s < 60) return s + 's ago';
            const m = Math.round(s / 60);
            return m < 60 ? m + ' min ago' : 'at ' + new Date(serverNow() - ms).toLocaleTimeString();
        }
        function setStatus(text, tone, detail) {
            statusEl.textContent = text;
            statusEl.style.background = COLORS[tone] || COLORS.idle;
            detailEl.textContent = detail || '';
        }

        function stop(text) {
            ended = true;
            clearTimeout(pollTimer); clearInterval(renderTimer); clearInterval(mapRetry);
            socket?.disconnect();
            setStatus('Sharing ended', 'idle', '');
            // Rendering stops here, so replace the ticking "Updated Xs ago" with a fixed time.
            if (last) $('viewerLastUpdate').textContent = 'Last shared position from ' + new Date(last.fixTime - clockOffset).toLocaleTimeString();
            message.hidden = false;
            message.textContent = text;
        }

        if (!/^[A-F0-9]{64}$/.test(code || '')) {
            stop('This old or invalid link cannot be used. Ask the sender to start a new journey and share its new link.');
            return;
        }

        function render() {
            if (ended) return;
            const now = serverNow();
            if (lastServerContact && Date.now() - lastServerContact > GUARDIAN_LOST_MS) {
                setStatus('Connection lost — retrying', 'bad', 'We can\'t reach HerShield from this device. Check your internet connection; the last known position is still shown.');
            } else if (!last) {
                if (senderState === 'background') setStatus('Paused', 'warn', 'The sender\'s phone is locked or HerShield isn\'t open on their screen, so their location can\'t update yet.');
                else setStatus('Waiting for GPS', 'idle', 'The sender hasn\'t shared a position yet. This updates automatically.');
            } else {
                const age = now - last.fixTime;
                const seenAge = senderSeenAt ? now - senderSeenAt : Infinity;
                if (senderState === 'background' && senderStateAt >= last.fixTime) {
                    setStatus('Paused', 'warn', 'The sender\'s phone is locked or HerShield isn\'t open on their screen, so their location can\'t update. Showing their last position, from ' + ago(age) + '.');
                } else if (age <= LIVE_MS) {
                    setStatus('Live', 'live', '');
                } else if (seenAge <= LIVE_MS) {
                    const old = age < 120000 ? Math.round(age / 1000) + ' seconds' : Math.round(age / 60000) + ' minutes';
                    setStatus('Weak GPS signal', 'warn', 'The sender is connected, but their phone hasn\'t got a new GPS fix — the position shown is ' + old + ' old.');
                } else if (age <= OFFLINE_MS) {
                    setStatus('Waiting for an update', 'warn', 'No new position for ' + Math.round(age / 1000) + 's. This can happen briefly with a weak signal.');
                } else {
                    const silence = age < 120000 ? Math.round(age / 1000) + ' seconds' : Math.round(age / 60000) + ' minutes';
                    setStatus('No recent updates', 'bad', 'No update for ' + silence + '. The sender may be offline, out of signal, or their phone may be locked. Try calling them. Showing their last known position.');
                }
                $('viewerLastUpdate').textContent = 'Updated ' + ago(age) + (Number.isFinite(last.accuracy) ? ' · accuracy ±' + Math.round(last.accuracy) + ' m' : '');
            }
        }

        function ensureMap() {
            if (map || !window.google?.maps || !last) return !!map;
            const position = { lat: last.lat, lng: last.lng };
            map = new google.maps.Map($('viewerMap'), { center: position, zoom: 16, streetViewControl: false, mapTypeControl: false });
            marker = new google.maps.Marker({ map, position, title: 'Sender\'s location' });
            trail = new google.maps.Polyline({ map, path: trailPoints, strokeColor: '#9b4938', strokeOpacity: 0.7, strokeWeight: 4 });
            map.addListener('dragstart', () => { follow = false; $('viewerRecenter').hidden = false; });
            message.hidden = true;
            return true;
        }
        $('viewerRecenter').addEventListener('click', () => {
            follow = true; $('viewerRecenter').hidden = true;
            if (map && last) { map.panTo({ lat: last.lat, lng: last.lng }); map.setZoom(Math.max(map.getZoom(), 15)); }
        });

        function drawPosition() {
            if (!ensureMap()) {
                if (!window.google?.maps) message.textContent = 'Loading the map… The latest position is shown above — use Open in Maps if the map doesn\'t appear.';
                return;
            }
            const position = { lat: last.lat, lng: last.lng };
            marker.setPosition(position);
            trail.setPath(trailPoints);
            if (follow) map.panTo(position);
            if (Number.isFinite(last.accuracy)) {
                if (!accuracyCircle) accuracyCircle = new google.maps.Circle({ map, strokeColor: '#9b4938', strokeWeight: 1, fillColor: '#ff9a86', fillOpacity: 0.15, clickable: false });
                accuracyCircle.setCenter(position); accuracyCircle.setRadius(last.accuracy);
            }
        }

        /** Apply any server payload (socket push, join ack, or REST). */
        function apply(data) {
            if (ended || !data) return;
            lastServerContact = Date.now();
            const serverTime = Date.parse(data.serverTime);
            if (Number.isFinite(serverTime)) clockOffset = serverTime - Date.now();
            if (data.senderState) { senderState = data.senderState; senderStateAt = Date.parse(data.senderStateAt) || serverNow(); }
            if (data.senderSeenAt) senderSeenAt = Math.max(senderSeenAt, Date.parse(data.senderSeenAt) || 0);
            const lat = Number(data.lat), lng = Number(data.lng);
            if (data.lat != null && data.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
                const fixTime = Date.parse(data.timestamp) || serverNow();
                // A REST poll can return an older (throttled) stored point after the
                // socket already delivered a newer one — never move backwards.
                if (!last || fixTime >= last.fixTime) {
                    const accuracy = Number.isFinite(Number(data.accuracy)) && data.accuracy != null ? Number(data.accuracy) : null;
                    const prev = trailPoints[trailPoints.length - 1];
                    if (!prev || Math.abs(prev.lat - lat) > 0.00003 || Math.abs(prev.lng - lng) > 0.00003) {
                        trailPoints.push({ lat, lng });
                        if (trailPoints.length > TRAIL_MAX) trailPoints.shift();
                    }
                    last = { lat, lng, accuracy, fixTime };
                    $('viewerCoords').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
                    const link = $('viewerOpenMaps'); link.href = 'https://maps.google.com/?q=' + lat + ',' + lng; link.hidden = false;
                    drawPosition();
                }
            }
            render();
        }

        function schedulePoll() {
            clearTimeout(pollTimer);
            if (!ended) pollTimer = setTimeout(poll, joined && socket?.connected ? POLL_SOCKET_MS : POLL_FALLBACK_MS);
        }
        async function poll() {
            if (ended) return;
            if (polling) { repoll = true; return; } // run once more right after, never drop it
            polling = true;
            try {
                const response = await fetch('/api/live-tracker/view/' + encodeURIComponent(code));
                const data = await response.json();
                if (ended) return;
                if (response.status === 410) { stop(data.message || 'The sender ended sharing, or this link expired.'); return; }
                if (!response.ok || !data.success) throw new Error('Location service unavailable');
                apply(data);
            } catch { render(); }
            finally {
                polling = false;
                if (repoll && !ended) { repoll = false; poll(); } else schedulePoll();
            }
        }

        // REST polling (3s) already works without this; the socket upgrades the
        // page to instant pushes once its client has loaded.
        loadSocketClient().then(io => {
            if (ended) return;
            socket = io(window.HERSHIELD_BACKEND || location.origin, { transports: ['polling'] });
            socket.on('connect', () => socket.emit('joinSession', { code }, result => {
                joined = !!result?.success;
                if (joined && result.location) apply(result.location); else poll();
                schedulePoll();
            }));
            socket.on('disconnect', () => { joined = false; schedulePoll(); });
            // New servers push coordinates; an older server only pings, so re-read via REST.
            socket.on('locationUpdated', data => { if (data && data.lat != null) apply(data); else poll(); });
            socket.on('senderState', data => apply(data));
            socket.on('sessionEnded', () => stop('The sender ended sharing, or this link expired.'));
            socket.on('trackingUnavailable', () => setStatus('Location service unavailable', 'bad', 'Retrying automatically.'));
        }).catch(() => { /* stay on fast REST polling */ });

        // Google Maps may finish loading after the first position arrives.
        mapRetry = setInterval(() => { if (map) clearInterval(mapRetry); else if (last && window.google?.maps) drawPosition(); }, 500);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
        renderTimer = setInterval(render, 1000);
        poll();
        window.addEventListener('pagehide', () => { clearTimeout(pollTimer); clearInterval(renderTimer); clearInterval(mapRetry); socket?.disconnect(); }, { once: true });
    }

    if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
