/**
 * Shared GPS sender for Live Tracker and SOS (window.HSLocationSender).
 *
 * - watchPosition streams fixes while moving; at most one upload is in flight
 *   and a fix that arrives meanwhile is sent next, never dropped.
 * - A heartbeat re-checks GPS while standing still, so guardians can tell
 *   "not moving" apart from "connection lost".
 * - Every upload carries the fix's real age, so a cached position is never
 *   presented to guardians as fresh.
 * - A locked or backgrounded phone cannot share location from a web page, so
 *   the screen is kept awake while sharing and guardians are told when the
 *   page goes to the background.
 */
(() => {
    'use strict';
    const MOVING_INTERVAL_MS = 2000;   // fastest upload cadence while fixes keep arriving
    const HEARTBEAT_MS = 10000;        // longest silence while standing still
    const RETRY_MS = 3000;
    const REQUEST_TIMEOUT_MS = 10000;
    const MAX_TRUSTED_ACCURACY_M = 2000;
    const UPDATE_URL = '/api/live-tracker/update-location';
    const STATE_URL = '/api/live-tracker/sender-state';

    function distanceKm(a, b) {
        const toRad = d => d * Math.PI / 180;
        const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    class LocationSender {
        /**
         * @param {object} options
         * @param {string} options.sessionId
         * @param {(fix:{lat:number,lng:number,accuracy:number|null,fixTime:number})=>void} [options.onFix]
         * @param {(status:{type:string}&object)=>void} [options.onStatus]
         * @param {(message:string)=>void} [options.onEnded]  the server ended or expired the share
         * @param {object} [options.env] injectable browser APIs (tests)
         */
        constructor({ sessionId, onFix, onStatus, onEnded, env = {} }) {
            this.sessionId = sessionId;
            this.onFix = onFix || (() => {});
            this.onStatus = onStatus || (() => {});
            this.onEnded = onEnded || (() => {});
            this.env = {
                geolocation: globalThis.navigator?.geolocation,
                fetch: (...args) => globalThis.fetch(...args),
                now: () => Date.now(),
                setInterval: (...args) => globalThis.setInterval(...args),
                clearInterval: (...args) => globalThis.clearInterval(...args),
                document: globalThis.document,
                wakeLock: globalThis.navigator?.wakeLock,
                isSecureContext: globalThis.isSecureContext,
                ...env,
            };
            this.latest = null;          // newest accepted fix
            this.unsent = false;         // latest fix not yet delivered
            this.inFlight = false;
            this.lastAttemptAt = 0;
            this.lastDeliveredAt = 0;
            this.lastHeartbeatAt = 0;
            this.lastFailedAt = 0;
            this.refreshing = false;
            this.stopped = true;
            this.watchId = null;
            this.ticker = null;
            this.wakeLock = null;
            this.postedState = null;
            this._onVisibility = () => this._visibilityChanged();
            this._onPageHide = () => this._postState('background');
            this._onGesture = () => this._acquireWakeLock();
        }

        start() {
            const { geolocation, document: doc } = this.env;
            this.stopped = false;
            if (!geolocation) { this.onStatus({ type: 'unsupported' }); return; }
            if (this.env.isSecureContext === false) { this.onStatus({ type: 'insecure' }); return; }
            this.watchId = geolocation.watchPosition(
                position => this._accept(position),
                error => this._geoError(error),
                { enableHighAccuracy: true, maximumAge: 0 }
            );
            this.ticker = this.env.setInterval(() => this._tick(), 1000);
            doc?.addEventListener('visibilitychange', this._onVisibility);
            globalThis.addEventListener?.('pagehide', this._onPageHide);
            this._acquireWakeLock();
            this._refreshFix();
        }

        stop() {
            this.stopped = true;
            if (this.watchId != null) this.env.geolocation?.clearWatch(this.watchId);
            this.watchId = null;
            if (this.ticker) this.env.clearInterval(this.ticker);
            this.ticker = null;
            this.env.document?.removeEventListener('visibilitychange', this._onVisibility);
            this.env.document?.removeEventListener('pointerdown', this._onGesture);
            globalThis.removeEventListener?.('pagehide', this._onPageHide);
            this.wakeLock?.release?.().catch?.(() => {});
            this.wakeLock = null;
        }

        _accept(position) {
            if (this.stopped) return false;
            const now = this.env.now();
            const lat = position.coords.latitude, lng = position.coords.longitude;
            const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
            // A future or missing timestamp is treated as "now"; anything else is the
            // real moment the fix was taken (a cached fix keeps its true age).
            const fixTime = Number.isFinite(position.timestamp) && position.timestamp <= now + 60000 ? Math.min(position.timestamp, now) : now;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
            if (this.latest && fixTime <= this.latest.fixTime) return false; // not newer
            if (accuracy != null && accuracy > MAX_TRUSTED_ACCURACY_M) {
                // Network/IP positioning — can be another city. Never share it.
                this.onStatus({ type: 'low-accuracy', accuracy });
                return false;
            }
            if (this.latest) {
                const km = distanceKm(this.latest, { lat, lng });
                const hours = (fixTime - this.latest.fixTime) / 3600000;
                // A genuine fast move comes with a precise fix; a "teleport" that is
                // itself imprecise is a bad network fallback reading.
                if (km > 2 && hours > 0 && km / hours > 300 && (accuracy ?? Infinity) > 300) {
                    this.onStatus({ type: 'jump', km });
                    return false;
                }
            }
            this.latest = { lat, lng, accuracy, fixTime };
            this.unsent = true;
            this.onFix(this.latest);
            this._maybeSend();
            return true;
        }

        _tick() {
            if (this.stopped) return;
            const now = this.env.now();
            if (!this.inFlight && now - this.lastDeliveredAt >= HEARTBEAT_MS && now - this.lastHeartbeatAt >= HEARTBEAT_MS) {
                this.lastHeartbeatAt = now;
                this._refreshFix({ heartbeat: true });
            }
            this._maybeSend();
        }

        /** Ask for a fresh fix now (start, heartbeat, or returning to the page). */
        _refreshFix({ heartbeat = false } = {}) {
            const { geolocation } = this.env;
            if (this.stopped || this.refreshing || !geolocation) return;
            this.refreshing = true;
            const done = accepted => {
                this.refreshing = false;
                // Even with no newer fix (indoors, standing still), re-send the last
                // one with its true age: it proves the sender is still connected.
                if (!accepted && heartbeat && this.latest) { this.unsent = true; this._maybeSend(); }
            };
            geolocation.getCurrentPosition(
                position => done(this._accept(position)),
                error => { this._geoError(error); done(false); },
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
            );
        }

        _maybeSend() {
            if (this.stopped || this.inFlight || !this.unsent || !this.latest) return;
            const now = this.env.now();
            const gap = this.lastFailedAt > this.lastDeliveredAt ? RETRY_MS : MOVING_INTERVAL_MS;
            if (now - this.lastAttemptAt < gap) return; // the 1s ticker sends it shortly
            this._send(now);
        }

        async _send(now) {
            const fix = this.latest;
            this.inFlight = true;
            this.unsent = false;
            this.lastAttemptAt = now;
            const timeout = globalThis.AbortSignal?.timeout ? globalThis.AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
            try {
                const response = await this.env.fetch(UPDATE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.sessionId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy,
                        fixAgeMs: Math.max(0, Math.round(this.env.now() - fix.fixTime)),
                    }),
                    signal: timeout,
                    hsQuiet: true, // this component reports its own status
                });
                const data = await response.json().catch(() => ({}));
                if (data.ended || [404, 409, 410].includes(response.status)) {
                    this.stop();
                    this.onEnded(data.message || 'This sharing session has ended.');
                    return;
                }
                if (!response.ok || !data.success) throw new Error(data.message || 'The server did not accept the location.');
                if (data.skipped) { this.onStatus({ type: 'skipped', message: data.message }); return; }
                this.lastDeliveredAt = this.env.now();
                this.postedState = 'active';
                this.onStatus({ type: 'sent', at: this.lastDeliveredAt, accuracy: fix.accuracy, fixAgeMs: this.lastDeliveredAt - fix.fixTime });
            } catch (error) {
                this.unsent = true; // retry with whatever the newest fix is by then
                this.lastFailedAt = this.env.now();
                this.onStatus({ type: 'retrying', message: error?.message || 'Network error' });
            } finally {
                this.inFlight = false;
                if (!this.stopped) this._maybeSend();
            }
        }

        _geoError(error) {
            this.onStatus({ type: 'geo-error', code: error?.code, message: error?.message });
        }

        async _acquireWakeLock() {
            const { wakeLock, document: doc } = this.env;
            if (this.stopped || this.wakeLock) return;
            if (!wakeLock?.request) { this.onStatus({ type: 'wake-lock', active: false, supported: false }); return; }
            if (doc && doc.visibilityState && doc.visibilityState !== 'visible') return;
            try {
                const lock = await wakeLock.request('screen');
                if (this.stopped) { lock.release?.().catch?.(() => {}); return; }
                this.wakeLock = lock;
                doc?.removeEventListener('pointerdown', this._onGesture);
                lock.addEventListener?.('release', () => {
                    this.wakeLock = null;
                    if (!this.stopped) this.onStatus({ type: 'wake-lock', active: false, supported: true });
                });
                this.onStatus({ type: 'wake-lock', active: true, supported: true });
            } catch {
                // Some browsers only grant it after a tap — retry on the next one.
                doc?.addEventListener('pointerdown', this._onGesture, { once: true });
                this.onStatus({ type: 'wake-lock', active: false, supported: true });
            }
        }

        _visibilityChanged() {
            if (this.stopped) return;
            if (this.env.document?.visibilityState === 'hidden') {
                this._postState('background');
            } else {
                this._postState('active');
                this._acquireWakeLock();
                this._refreshFix({ heartbeat: true });
            }
        }

        _postState(state) {
            if (this.stopped || this.postedState === state) return;
            this.postedState = state;
            this.env.fetch(STATE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId, state }),
                keepalive: true, // may be sent while the page is being hidden
                hsQuiet: true,
            }).catch(() => { if (this.postedState === state) this.postedState = null; });
        }
    }

    LocationSender.MOVING_INTERVAL_MS = MOVING_INTERVAL_MS;
    LocationSender.HEARTBEAT_MS = HEARTBEAT_MS;
    globalThis.HSLocationSender = LocationSender;
})();
