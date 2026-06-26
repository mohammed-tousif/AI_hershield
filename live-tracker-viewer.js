/**
 * Live Tracker — Viewer mode for emergency contacts.
 * Activated when URL contains ?track=<sessionId> or ?code=<trackingCode>.
 * Must load after config.js (for API proxy) and before Google Maps.
 */
(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get('track');
    const codeParam = params.get('code');
    if (!trackParam && !codeParam) return;

    function socketOrigin() {
        return window.HERSHIELD_BACKEND || window.location.origin;
    }

    function buildViewerShell() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes hs-pulse-dot {
                0%, 100% { opacity:1; transform:scale(1); }
                50%       { opacity:0.5; transform:scale(1.4); }
            }
            #viewerMode { font-family:'Poppins',sans-serif; }
        `;
        document.head.appendChild(style);

        const shell = document.createElement('div');
        shell.id = 'viewerMode';
        shell.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:#F2EAE0;';
        shell.innerHTML = `
            <div style="position:absolute;top:0;left:0;right:0;height:60px;z-index:10;background:linear-gradient(135deg,#9B8EC7,#7A6B99);display:flex;align-items:center;justify-content:space-between;padding:0 20px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:1.4rem;">🛡️</span>
                    <div>
                        <div style="color:white;font-weight:700;font-size:1.1rem;">HerShield</div>
                        <div style="color:rgba(255,255,255,0.8);font-size:0.75rem;">Live Safety Tracker — Viewer</div>
                    </div>
                </div>
                <div id="viewerStatusPill" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);border-radius:50px;padding:6px 16px;">
                    <span id="viewerDot" style="width:10px;height:10px;border-radius:50%;background:#ffc107;display:inline-block;animation:hs-pulse-dot 1.5s ease-in-out infinite;"></span>
                    <span id="viewerStatusText" style="color:white;font-size:0.82rem;font-weight:600;">Connecting…</span>
                </div>
            </div>
            <div id="viewerInfoBar" style="position:absolute;top:60px;left:0;right:0;z-index:10;background:rgba(255,255,255,0.92);padding:10px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;border-bottom:1px solid rgba(0,0,0,0.08);">
                <div><i class="fas fa-crosshairs" style="color:#9B8EC7;"></i> <span id="viewerCoords">Waiting…</span></div>
                <div><i class="fas fa-clock" style="color:#9B8EC7;"></i> <span id="viewerLastUpdate">–</span></div>
                <a id="viewerOpenMaps" href="#" target="_blank" style="margin-left:auto;display:none;background:#007bff;color:white;padding:6px 14px;border-radius:20px;text-decoration:none;font-size:0.8rem;">Open in Maps</a>
            </div>
            <div id="viewerMap" style="position:absolute;top:108px;left:0;right:0;bottom:0;"></div>
            <div id="viewerWaiting" style="position:absolute;top:108px;left:0;right:0;bottom:0;background:rgba(242,234,224,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:5;">
                <p id="viewerWaitingMsg" style="text-align:center;color:#555;max-width:320px;">Connecting to tracking session…</p>
            </div>`;
        document.body.appendChild(shell);
    }

    function hideTrackerUI() {
        ['#fixedSidebarToggle', '#fixedActionsToggle', '.sidebar', '.header-bar', '.main-content', '.gradient-background', '.gradient-overlay']
            .forEach((sel) => {
                document.querySelectorAll(sel).forEach((el) => { el.style.display = 'none'; });
            });
        document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#F2EAE0;';
    }

    function setStatus(type, text) {
        const dot = document.getElementById('viewerDot');
        const span = document.getElementById('viewerStatusText');
        if (!dot || !span) return;
        span.textContent = text;
        const colors = { connected: '#2DCE89', warning: '#ffc107', error: '#f5365c', ended: '#adb5bd' };
        dot.style.background = colors[type] || '#ffc107';
        dot.style.animation = type === 'connected' ? 'hs-pulse-dot 1.5s ease-in-out infinite' : 'none';
    }

    async function resolveSessionId() {
        if (trackParam) return trackParam;
        const resp = await fetch('/api/live-tracker/lookup-code/' + encodeURIComponent(codeParam));
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.message || 'Invalid tracking code');
        return data.userId;
    }

    function initViewerMode(sessionId) {
        let viewerMap = null;
        let viewerMarker = null;
        let viewerCircle = null;

        function applyLocation(lat, lng, accuracy, ts) {
            document.getElementById('viewerCoords').textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);
            document.getElementById('viewerLastUpdate').textContent = (ts ? new Date(ts) : new Date()).toLocaleTimeString();
            const mapsLink = document.getElementById('viewerOpenMaps');
            mapsLink.href = 'https://maps.google.com/?q=' + lat + ',' + lng;
            mapsLink.style.display = 'inline-block';
            document.getElementById('viewerWaiting').style.display = 'none';
            setStatus('connected', '🟢 Live — receiving updates');

            if (typeof google === 'undefined' || !google.maps) return;
            const pos = { lat, lng };
            if (!viewerMap) {
                viewerMap = new google.maps.Map(document.getElementById('viewerMap'), {
                    zoom: 16, center: pos, mapTypeControl: false, streetViewControl: false,
                });
            }
            if (!viewerMarker) {
                viewerMarker = new google.maps.Marker({ position: pos, map: viewerMap, title: 'Live Location' });
                viewerCircle = new google.maps.Circle({
                    map: viewerMap, center: pos, radius: accuracy || 50,
                    fillColor: '#9B8EC7', fillOpacity: 0.12, strokeColor: '#9B8EC7', strokeOpacity: 0.35,
                });
            } else {
                viewerMarker.setPosition(pos);
                viewerCircle.setCenter(pos);
                viewerCircle.setRadius(accuracy || 50);
            }
            viewerMap.panTo(pos);
        }

        function pollLocation(sid) {
            fetch('/api/live-tracker/location/' + encodeURIComponent(sid))
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (!data || !data.success || data.lat == null) return;
                    applyLocation(data.lat, data.lng, data.accuracy || 50, data.timestamp);
                })
                .catch(() => {});
        }

        const socket = window.io ? window.io(socketOrigin(), { transports: ['polling'] }) : null;
        if (socket) {
            socket.on('connect', () => {
                setStatus('connected', '🟢 Live — receiving updates');
                socket.emit('joinSession', sessionId);
            });
            socket.on('connect_error', () => setStatus('warning', '⚠️ Connection lost — retrying…'));
            socket.on('locationUpdated', (data) => {
                if (!data || !data.location) return;
                applyLocation(data.location.lat, data.location.lng, data.location.accuracy || 50, data.timestamp);
            });
            socket.on('sessionEnded', () => {
                setStatus('ended', '🏁 Tracking session ended');
                document.getElementById('viewerWaitingMsg').textContent = 'The tracking session has ended.';
                document.getElementById('viewerWaiting').style.display = 'flex';
            });
        } else {
            setStatus('warning', '⚠️ Polling only');
        }

        pollLocation(sessionId);
        setInterval(() => pollLocation(sessionId), 10000);
    }

    document.addEventListener('DOMContentLoaded', async function () {
        buildViewerShell();
        hideTrackerUI();
        document.getElementById('viewerMode').style.display = 'block';

        try {
            const sessionId = await resolveSessionId();
            initViewerMode(sessionId);
        } catch (err) {
            setStatus('error', 'Invalid link');
            document.getElementById('viewerWaitingMsg').textContent = err.message || 'Could not open tracking session.';
        }
    });
})();
