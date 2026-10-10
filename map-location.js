/* Shared, bounded location acquisition for the dashboard and Safety Map. */
(function (root) {
    'use strict';
    const MAX_ACCURACY = 2000, TARGET_ACCURACY = 100, MAX_AGE = 30000;
    function validPosition(position, now = Date.now()) {
        const c = position?.coords;
        return !!c && Number.isFinite(c.latitude) && Math.abs(c.latitude) <= 90 &&
            Number.isFinite(c.longitude) && Math.abs(c.longitude) <= 180 &&
            Number.isFinite(c.accuracy) && c.accuracy >= 0 &&
            Number.isFinite(position.timestamp) && now - position.timestamp <= MAX_AGE && position.timestamp <= now + 10000;
    }
    function errorMessage(error) {
        return ({
            1: 'Location permission is blocked. Allow location for this site and enable precise location in your device settings, then retry.',
            2: 'Your device could not determine your location. Check device location services, or enter a starting place manually.',
            3: 'Location timed out. Check device location services and retry; on a phone, moving near a window may help.'
        })[error?.code] || error?.message || 'Unable to determine your location. Please retry.';
    }
    function requestPosition({ geolocation = root.navigator?.geolocation, timeout = 15000, onProgress = () => {}, signal } = {}) {
        return new Promise((resolve, reject) => {
            if (root.isSecureContext === false) return reject(new Error('Location requires HTTPS. Open the secure HerShield website.'));
            if (!geolocation) return reject(new Error('This browser does not support location. Enter a starting place manually.'));
            let best = null, lastError = null, watchId, timer, done = false;
            function finish(error, position) {
                if (done) return;
                done = true; clearTimeout(timer);
                if (watchId !== undefined) geolocation.clearWatch(watchId);
                signal?.removeEventListener('abort', abort);
                if (error) reject(error); else resolve(position);
            }
            function abort() { finish(new Error('Location request cancelled.')); }
            if (signal?.aborted) return abort();
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => {
                if (best && validPosition(best) && best.coords.accuracy <= MAX_ACCURACY) return finish(null, best);
                const message = best ? `Your device only reported an approximate area (±${Math.ceil(best.coords.accuracy / 1000)} km). No current-location pin was placed. Enable precise device location or enter a starting place manually.` : errorMessage(lastError || { code: 3 });
                finish(new Error(message));
            }, timeout);
            try {
                watchId = geolocation.watchPosition(position => {
                    if (done || !validPosition(position)) return;
                    if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
                    if (best.coords.accuracy <= TARGET_ACCURACY) return finish(null, best);
                    onProgress(`Improving location accuracy… current estimate ±${Math.round(best.coords.accuracy)} m.`);
                }, error => {
                    if (done) return;
                    lastError = error;
                    if (error.code === 1) finish(new Error(errorMessage(error)));
                }, { enableHighAccuracy: true, maximumAge: 0, timeout });
                if (done) geolocation.clearWatch(watchId); // Also supports synchronous providers in tests.
            } catch (error) { finish(new Error(errorMessage(error))); }
        });
    }
    class MapLocation {
        constructor({ getMap, status, buttons = [] }) {
            this.getMap = getMap; this.status = status; this.buttons = buttons;
            this.marker = null; this.circle = null; this.pending = null;
            root.addEventListener?.('pagehide', () => this.controller?.abort());
        }
        say(text) { if (this.status) this.status.textContent = text; }
        clearPin() {
            this.marker?.setMap(null); this.circle?.setMap(null);
            this.marker = null; this.circle = null;
        }
        locate() {
            if (this.pending) return this.pending;
            if (!this.getMap()) { this.say('The map is still loading. Please retry when it appears.'); return Promise.resolve(null); }
            this.clearPin();
            this.say('Finding your location… allow location access if your browser asks.');
            this.buttons.forEach(button => { if (button) button.disabled = true; });
            this.controller = new AbortController();
            this.pending = requestPosition({ signal: this.controller.signal, onProgress: text => this.say(text) }).then(position => {
                const map = this.getMap(), c = position.coords, point = { lat: c.latitude, lng: c.longitude };
                const approximate = c.accuracy > TARGET_ACCURACY;
                map.setCenter(point); map.setZoom(c.accuracy > 500 ? 13 : approximate ? 15 : 16);
                this.marker = new root.google.maps.Marker({ map, position: point,
                    title: `${approximate ? 'Approximate device location' : 'Device location'} (±${Math.round(c.accuracy)} m)`,
                    icon: { path: root.google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
                this.circle = new root.google.maps.Circle({ map, center: point, radius: c.accuracy, strokeColor: '#2563eb', strokeWeight: 1, fillColor: '#2563eb', fillOpacity: .12, clickable: false });
                this.say(`${approximate ? 'Approximate device location' : 'Device location'} · accuracy ±${Math.round(c.accuracy)} m · updated ${new Date(position.timestamp).toLocaleTimeString()}. The circle shows the reported uncertainty. Recenter to refresh.`);
                return position;
            }).catch(error => { this.say(errorMessage(error) + ' The map view is not a confirmed current location.'); return null; })
                .finally(() => { this.pending = null; this.buttons.forEach(button => { if (button) button.disabled = false; }); });
            return this.pending;
        }
    }
    root.HSMapLocation = { requestPosition, validPosition, MapLocation };
    if (typeof module === 'object' && module.exports) module.exports = root.HSMapLocation;
})(typeof window === 'object' ? window : globalThis);
