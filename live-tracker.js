// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HerShield Live Safety Tracker  –  live-tracker.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Use relative /api paths — config.js rewrites them to the Render backend on Firebase Hosting.

// ── JSON helper ──────────────────────────────────────────────────────────────
async function readJsonResponse(response) {
    const text = await response.text();
    if (!text || !text.trim()) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `Invalid response (HTTP ${response.status}). Open this page from the same host/port as the Her Shield server (e.g. http://localhost:3000/live-tracker.html).`
        );
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Location Autocomplete Engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class LocationAutocomplete {
    /**
     * @param {string} inputId       – id of the text <input>
     * @param {string} suggestionsId – id of the suggestions <div>
     * @param {string} latId         – id of hidden lat <input>
     * @param {string} lngId         – id of hidden lng <input>
     * @param {string} gpsBtnId      – id of the GPS <button>
     */
    constructor(inputId, suggestionsId, latId, lngId, gpsBtnId) {
        this.input      = document.getElementById(inputId);
        this.dropdown   = document.getElementById(suggestionsId);
        this.latField   = document.getElementById(latId);
        this.lngField   = document.getElementById(lngId);
        this.gpsBtn     = document.getElementById(gpsBtnId);

        this.autocompleteService = null;
        this.geocoder            = null;
        this.sessionToken        = null;
        this.activeIndex         = -1;
        this.debounceTimer       = null;
        this.lastQuery           = '';

        this._bindEvents();
    }

    // Called by SafetyTracker after Google Maps loads
    initGoogle() {
        if (typeof google === 'undefined') return;
        this.autocompleteService = new google.maps.places.AutocompleteService();
        this.geocoder            = new google.maps.Geocoder();
        this.sessionToken        = new google.maps.places.AutocompleteSessionToken();
    }

    _bindEvents() {
        if (!this.input) return;

        // Typing → debounced search
        this.input.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            const q = this.input.value.trim();
            if (q === this.lastQuery) return;
            this.lastQuery = q;
            // Clear coords when user edits text
            if (this.latField) this.latField.value = '';
            if (this.lngField) this.lngField.value = '';
            if (q.length < 2) { this._close(); return; }
            this.debounceTimer = setTimeout(() => this._search(q), 280);
        });

        // Keyboard navigation
        this.input.addEventListener('keydown', (e) => {
            const items = this.dropdown ? this.dropdown.querySelectorAll('.lt-suggestion-item') : [];
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.activeIndex = Math.min(this.activeIndex + 1, items.length - 1);
                this._highlight(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.activeIndex = Math.max(this.activeIndex - 1, -1);
                this._highlight(items);
            } else if (e.key === 'Enter' && this.activeIndex >= 0) {
                e.preventDefault();
                items[this.activeIndex]?.click();
            } else if (e.key === 'Escape') {
                this._close();
            }
        });

        // Click outside → close
        document.addEventListener('click', (e) => {
            if (!this.input.contains(e.target) && !this.dropdown?.contains(e.target)) {
                this._close();
            }
        });

        // GPS button
        if (this.gpsBtn) {
            this.gpsBtn.addEventListener('click', () => this._useGPS());
        }
    }

    _search(query) {
        if (!this.autocompleteService) return;
        this.autocompleteService.getPlacePredictions(
            { input: query, sessionToken: this.sessionToken },
            (predictions, status) => {
                if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
                    this._close(); return;
                }
                this._renderPredictions(predictions);
            }
        );
    }

    _renderPredictions(predictions) {
        if (!this.dropdown) return;
        this.activeIndex = -1;
        this.dropdown.innerHTML = predictions.map((p, i) => {
            const main    = p.structured_formatting?.main_text    || p.description;
            const secondary = p.structured_formatting?.secondary_text || '';
            return `
            <div class="lt-suggestion-item" data-place-id="${p.place_id}" data-index="${i}">
                <div class="lt-place-icon"><i class="fas fa-map-marker-alt"></i></div>
                <div>
                    <div class="lt-place-name">${main}</div>
                    ${secondary ? `<div class="lt-place-address">${secondary}</div>` : ''}
                </div>
            </div>`;
        }).join('');

        // Attach click handlers
        this.dropdown.querySelectorAll('.lt-suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const placeId = item.dataset.placeId;
                const name    = item.querySelector('.lt-place-name')?.textContent || '';
                const addr    = item.querySelector('.lt-place-address')?.textContent || '';
                this._selectPlace(placeId, name, addr);
            });
        });

        this.dropdown.classList.add('open');
    }

    _selectPlace(placeId, name, addr) {
        if (!this.geocoder) return;
        this.geocoder.geocode({ placeId }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const loc = results[0].geometry.location;
                if (this.latField) this.latField.value = loc.lat();
                if (this.lngField) this.lngField.value = loc.lng();
                this.input.value = name + (addr ? `, ${addr}` : '');
                // Fresh session token after selection
                this.sessionToken = new google.maps.places.AutocompleteSessionToken();
            } else {
                this.input.value = name + (addr ? `, ${addr}` : '');
            }
        });
        this._close();
    }

    _highlight(items) {
        items.forEach((el, i) => el.classList.toggle('active', i === this.activeIndex));
        if (this.activeIndex >= 0) items[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    _close() {
        if (this.dropdown) this.dropdown.classList.remove('open');
        this.activeIndex = -1;
    }

    // ── GPS auto-fill ──────────────────────────────────────────────────────
    _useGPS() {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser.');
            return;
        }
        if (this.gpsBtn) {
            this.gpsBtn.classList.add('loading');
            this.gpsBtn.disabled = true;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (this.latField) this.latField.value = lat;
                if (this.lngField) this.lngField.value = lng;

                // Reverse geocode to get a human-readable address
                if (this.geocoder) {
                    this.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                        if (status === 'OK' && results[0]) {
                            this.input.value = results[0].formatted_address;
                        } else {
                            this.input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                        }
                        this._resetGpsBtn();
                    });
                } else {
                    this.input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
                    this._resetGpsBtn();
                }
            },
            (err) => {
                console.warn('GPS error:', err.message);
                alert('Could not get your location. Please ensure location access is allowed.');
                this._resetGpsBtn();
            },
            { enableHighAccuracy: true, timeout: 12000 }
        );
    }

    _resetGpsBtn() {
        if (this.gpsBtn) {
            this.gpsBtn.classList.remove('loading');
            this.gpsBtn.disabled = false;
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Safety Tracker (core session logic)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SafetyTracker {
    constructor() {
        this.sessionId      = null;
        this.pin            = null;
        this.verifyInterval = 120000;
        this.pinTimeout     = 20000;
        this.checkTimerId   = null;
        this.responseTimerId = null;
        this.watchId        = null;
        this.isTracking     = false;
        this.trackingLink   = null;
        this._geoErrorShown = false;

        // Map elements
        this.map           = null;
        this.marker        = null;
        this.accuracyCircle = null;

        // Autocomplete instances  (created in initGoogle())
        this.startAC = new LocationAutocomplete(
            'startPoint', 'startPointSuggestions', 'startLat', 'startLng', 'gpsStartBtn'
        );
        this.destAC = new LocationAutocomplete(
            'destination', 'destinationSuggestions', 'destLat', 'destLng', 'gpsDestBtn'
        );

        this._bindEvents();
        this.restoreSession();
        // initGoogle() is called by initMap() once Maps API is ready
    }

    // ── Wire UI events ────────────────────────────────────────────────────
    _bindEvents() {
        const get = (id) => document.getElementById(id);

        // Start tracking
        const startBtn = get('startTrackingBtn');
        if (startBtn) startBtn.addEventListener('click', (e) => this.handleStartTracking(e));

        // Safety check PIN
        const confirmBtn = get('confirmSafety');
        if (confirmBtn) confirmBtn.addEventListener('click', () => this.handleVerifyPin());

        // End tracking → show modal
        const endBtn = get('endTracking');
        if (endBtn) endBtn.addEventListener('click', () => {
            new bootstrap.Modal(get('endTrackingModal')).show();
        });

        // Confirm end tracking
        const confirmEndBtn = get('confirmEndTrackingBtn');
        if (confirmEndBtn) confirmEndBtn.addEventListener('click', () => this.handleStopTracking());

        // Trigger emergency → show modal
        const emergencyBtn = get('triggerEmergencyBtn');
        if (emergencyBtn) emergencyBtn.addEventListener('click', () => {
            new bootstrap.Modal(get('sosModal')).show();
        });

        // Confirm SOS
        const confirmSosBtn = get('confirmSosBtn');
        if (confirmSosBtn) confirmSosBtn.addEventListener('click', () => {
            const modalEl = get('sosModal');
            bootstrap.Modal.getInstance(modalEl)?.hide();
            this.triggerEmergency();
        });

        // Copy tracking link
        const copyBtn = get('copyTrackingLinkBtn');
        if (copyBtn) copyBtn.addEventListener('click', () => {
            if (this.trackingLink) {
                navigator.clipboard.writeText(this.trackingLink).then(() => {
                    copyBtn.innerHTML = '<i class="fas fa-check me-1"></i>Copied!';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy me-1"></i>Copy'; }, 2000);
                });
            }
        });
    }

    // ── Map init (called by Google Maps callback) ─────────────────────────
    initMap() {
        // Hand Google Maps objects to the autocomplete instances
        this.startAC.initGoogle();
        this.destAC.initGoogle();

        const mapEl = document.getElementById('map');
        if (!mapEl || typeof google === 'undefined') return;

        const defaultPos = { lat: 15.3647, lng: 75.1240 };

        this.map = new google.maps.Map(mapEl, {
            zoom: 15,
            center: defaultPos,
            mapTypeId: google.maps.MapTypeId.ROADMAP,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
        });

        // Use real GPS to center the map immediately
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    this.map.setCenter(p);
                    this._placeMarker(p, pos.coords.accuracy || 50);
                },
                () => this._placeMarker(defaultPos, 50)
            );
        } else {
            this._placeMarker(defaultPos, 50);
        }
    }

    _placeMarker(pos, accuracy) {
        if (!this.map) return;
        const svgIcon = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
            <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                <circle cx="20" cy="20" r="18" fill="#9B8EC7" fill-opacity="0.8" stroke="white" stroke-width="3"/>
                <circle cx="20" cy="20" r="8" fill="white"/>
                <circle cx="20" cy="20" r="4" fill="#9B8EC7"/>
            </svg>`)}`;

        if (this.marker) this.marker.setMap(null);
        if (this.accuracyCircle) this.accuracyCircle.setMap(null);

        this.marker = new google.maps.Marker({
            position: pos, map: this.map, title: 'Your Location',
            animation: google.maps.Animation.DROP,
            icon: { url: svgIcon, scaledSize: new google.maps.Size(40,40), anchor: new google.maps.Point(20,20) }
        });
        this.accuracyCircle = new google.maps.Circle({
            map: this.map, center: pos, radius: accuracy,
            fillColor: '#9B8EC7', fillOpacity: 0.12,
            strokeColor: '#9B8EC7', strokeOpacity: 0.35, strokeWeight: 2
        });
    }

    // ── Start Tracking ────────────────────────────────────────────────────
    async handleStartTracking(e) {
        if (e) e.preventDefault();

        const name = localStorage.getItem('hershield_user_name')
            || localStorage.getItem('hershield_user_email')?.split('@')[0]
            || 'User';
        const userEmail = localStorage.getItem('hershield_user_email') || '';

        // Collect emergency contacts
        let savedContacts = [];
        try {
            const raw = localStorage.getItem('hershield_emergency_contacts') || '[]';
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) savedContacts = parsed;
        } catch { savedContacts = []; }
        const emergencyContacts = savedContacts.map(c => c.email).filter(Boolean);

        const startPoint    = document.getElementById('startPoint')?.value?.trim()   || '';
        const destination   = document.getElementById('destination')?.value?.trim()  || '';
        const transportMode = document.getElementById('transportMode')?.value        || '';
        const pin           = document.getElementById('pin')?.value                  || '';
        const startLat      = document.getElementById('startLat')?.value;
        const startLng      = document.getElementById('startLng')?.value;

        // Validation
        if (!startPoint || !destination) {
            this.showNotification('Missing Location', 'Please enter both Starting Point and Destination.', 'warning');
            return;
        }
        if (!transportMode) {
            this.showNotification('Missing Information', 'Please select a Mode of Transport.', 'warning');
            return;
        }
        if (!pin || pin.length !== 6 || isNaN(pin)) {
            this.showNotification('Invalid PIN', 'PIN must be exactly 6 digits.', 'warning');
            return;
        }
        if (emergencyContacts.length === 0) {
            this.showNotification('No Emergency Contacts', 'Please add emergency contacts from your profile before starting tracking.', 'warning');
            return;
        }

        // Build body – include lat/lng so backend can put it in the email's map link
        const body = {
            name, email: userEmail,
            emergencyContacts,
            source: startPoint,
            destination,
            transportMode,
            pin,
            baseUrl: window.location.origin,  // send real origin so tracking link works on any IP
        };
        if (startLat && startLng) {
            body.startLat = parseFloat(startLat);
            body.startLng = parseFloat(startLng);
        }

        const startBtn = document.getElementById('startTrackingBtn');
        if (startBtn) { startBtn.disabled = true; startBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Starting…'; }

        try {
            const resp = await fetch(`/api/live-tracker/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            let data;
            try { data = await readJsonResponse(resp); }
            catch (err) {
                this.showNotification('Connection Error', err.message, 'error');
                return;
            }

            if (!resp.ok || !data.success) {
                this.showNotification('Error', data.message || `Failed to start tracking (HTTP ${resp.status})`, 'error');
                return;
            }

            this.sessionId      = data.sessionId;
            this.pin            = pin;
            this.verifyInterval = data.verifyInterval || 120000;
            this.pinTimeout     = data.pinTimeout     || 20000;
            this.trackingLink   = data.trackingLink   || null;

            this.saveSession({
                sessionId: this.sessionId, pin: this.pin,
                verifyInterval: this.verifyInterval, pinTimeout: this.pinTimeout,
                trackingLink: this.trackingLink, startTime: Date.now()
            });

            this._showTrackingLink();
            this.startTrackingSession();
        } catch (err) {
            console.error('Start tracking error:', err);
            this.showNotification('Error', err.message || 'Server error. Please try again.', 'error');
        } finally {
            if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = '<i class="fas fa-satellite-dish me-2"></i>Start Live Tracking'; }
        }
    }

    // Display tracking link card
    _showTrackingLink() {
        const card   = document.getElementById('trackingLinkCard');
        const anchor = document.getElementById('trackingLinkAnchor');
        if (!card || !anchor || !this.trackingLink) return;
        anchor.href        = this.trackingLink;
        anchor.textContent = this.trackingLink;
        card.style.display = 'block';
    }

    // ── Session persistence ───────────────────────────────────────────────
    saveSession(data) { localStorage.setItem('safetyTrackerSession', JSON.stringify(data)); }

    restoreSession() {
        try {
            const raw = localStorage.getItem('safetyTrackerSession');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (Date.now() - data.startTime > 86400000) { this.clearSession(); return; }
            this.sessionId      = data.sessionId;
            this.pin            = data.pin;
            this.verifyInterval = data.verifyInterval;
            this.pinTimeout     = data.pinTimeout;
            this.trackingLink   = data.trackingLink || null;
            this.startTrackingSession();
            this._showTrackingLink();
            this.showToast('Session Restored', 'Resuming your live tracking session.');
        } catch { this.clearSession(); }
    }

    clearSession() { localStorage.removeItem('safetyTrackerSession'); }

    // ── Active tracking session ───────────────────────────────────────────
    startTrackingSession() {
        this.isTracking = true;

        document.getElementById('initialForm').style.display  = 'none';
        document.getElementById('trackingView').style.display = 'block';

        if (this.map) {
            google.maps.event.trigger(this.map, 'resize');
            if (this.marker) { this.map.panTo(this.marker.getPosition()); this.map.setZoom(15); }
        }

        if (!navigator.geolocation) {
            this.showNotification('Location Not Supported', 'Your browser does not support GPS location, so your live location cannot be shared. Please use a different browser/device.', 'error');
        } else if (window.isSecureContext === false) {
            this.showNotification('Insecure Connection', 'This page was opened over a plain http:// address, so the browser blocks GPS access. Open it over https:// (or localhost) to share your live location.', 'error');
        } else {
            this.watchId = navigator.geolocation.watchPosition(
                (pos) => this.handleLocationUpdate(pos),
                (err) => this.handleGeoError(err),
                { enableHighAccuracy: true }
            );
        }

        this.resetVerificationTimer();

        window.onbeforeunload = (e) => {
            if (this.isTracking) {
                e.preventDefault();
                e.returnValue = 'Tracking is active. Reloading will interrupt the session.';
                return e.returnValue;
            }
        };
    }

    async handleLocationUpdate(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy || 50;

        if (this.map) {
            const p = { lat, lng };
            if (this.marker) { this.marker.setPosition(p); this.map.panTo(p); }
            else this._placeMarker(p, accuracy);
            if (this.accuracyCircle) { this.accuracyCircle.setCenter(p); this.accuracyCircle.setRadius(accuracy); }
        }

        try {
            await fetch(`/api/live-tracker/update-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId, lat, lng, accuracy })
            });
        } catch (err) { console.warn('Location update failed:', err.message); }
    }

    /** Surface geolocation failures to the user instead of only logging them —
     *  otherwise "live tracking" silently stops sharing location with no feedback. */
    handleGeoError(err) {
        console.warn('Geolocation error:', err.message);
        if (this._geoErrorShown) return; // avoid stacking repeated modals
        this._geoErrorShown = true;
        const messages = {
            1: 'Location permission was denied, so your live location is NOT being shared with your emergency contacts. Please allow location access for this site and restart tracking.',
            2: 'Your location is currently unavailable (GPS/location services may be off), so live tracking is paused.',
            3: 'Location request timed out. Live tracking will keep retrying, but your location may not be up to date.',
        };
        this.showNotification('Location Sharing Interrupted', messages[err.code] || ('Could not get your location: ' + err.message), 'error');
        // Allow a fresh warning if it happens again later in the session
        setTimeout(() => { this._geoErrorShown = false; }, 60000);
    }

    // ── Verification timer ────────────────────────────────────────────────
    resetVerificationTimer() {
        if (this.checkTimerId) clearInterval(this.checkTimerId);
        let timeLeft = this.verifyInterval / 1000;
        const countdownEl = document.getElementById('countdown');

        this.checkTimerId = setInterval(() => {
            if (!this.isTracking) return;
            timeLeft--;
            if (countdownEl) {
                const m = Math.floor(timeLeft / 60);
                const s = Math.floor(timeLeft % 60);
                countdownEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
            }
            if (timeLeft <= 0) { clearInterval(this.checkTimerId); this.showPinModal(); }
        }, 1000);
    }

    showPinModal() {
        const modalEl = document.getElementById('safetyCheckModal');
        if (!modalEl) return;
        new bootstrap.Modal(modalEl).show();
        const audio = document.getElementById('alertSound');
        if (audio) audio.play().catch(() => {});
        if (this.responseTimerId) clearTimeout(this.responseTimerId);
        this.responseTimerId = setTimeout(() => {
            if (modalEl.classList.contains('show')) {
                bootstrap.Modal.getInstance(modalEl)?.hide();
                this.triggerEmergency();
            }
        }, this.pinTimeout);
    }

    async handleVerifyPin() {
        const inputEl = document.getElementById('safetyCodeInput');
        const errorDiv = document.getElementById('codeError');
        if (!inputEl || !errorDiv) return;
        const inputPin = inputEl.value;
        if (inputPin !== this.pin) { errorDiv.style.display = 'block'; errorDiv.textContent = 'Incorrect PIN!'; return; }

        try {
            const resp = await fetch(`/api/live-tracker/verify-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId, pin: inputPin })
            });
            const data = await readJsonResponse(resp);
            if (!resp.ok || !data.success) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = data.message || 'Verification failed';
                return;
            }
        } catch { /* ignore network hiccups */ }

        errorDiv.style.display = 'none';
        inputEl.value = '';
        const modalEl = document.getElementById('safetyCheckModal');
        bootstrap.Modal.getInstance(modalEl)?.hide();
        if (this.responseTimerId) clearTimeout(this.responseTimerId);
        this.showToast('Safety Confirmed ✅', 'Next check in 2 minutes.');
        this.resetVerificationTimer();
    }

    // ── Emergency trigger ─────────────────────────────────────────────────
    async triggerEmergency() {
        if (!this.sessionId) {
            this.showNotification('Error', 'No active tracking session found. Cannot send alert.', 'error');
            return;
        }
        this.isTracking = false;

        const statusEl = document.getElementById('statusIndicator');
        if (statusEl) {
            statusEl.className = 'status-indicator status-danger';
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> EMERGENCY ALERT TRIGGERED';
        }

        try {
            const resp = await fetch(`/api/live-tracker/trigger-alert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId })
            });
            const data = await readJsonResponse(resp);
            if (!resp.ok || !data.success) throw new Error(data.message || `HTTP ${resp.status}`);
            this.showNotification('Emergency Alert Sent 🚨', 'Your contacts have been notified via email with your location.', 'success');
        } catch (err) {
            console.error('Emergency trigger error:', err);
            this.showNotification('Alert Failed', `Could not send alert: ${err.message}. Call for help immediately!`, 'error');
        }
    }

    // ── Stop tracking ─────────────────────────────────────────────────────
    async handleStopTracking() {
        const endPinEl  = document.getElementById('endTrackingPin');
        const errorDiv  = document.getElementById('endTrackingError');
        if (!endPinEl || !errorDiv) return;
        const inputPin  = endPinEl.value;
        if (inputPin !== this.pin) { errorDiv.style.display = 'block'; errorDiv.textContent = 'Incorrect PIN!'; return; }

        try {
            const resp = await fetch(`/api/live-tracker/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId, pin: inputPin })
            });
            const data = await readJsonResponse(resp);
            if (!resp.ok || !data.success) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = data.message || `Could not stop session (HTTP ${resp.status})`;
                return;
            }
        } catch (err) {
            this.showNotification('Error', err.message, 'error'); return;
        }

        this.isTracking = false;
        window.onbeforeunload = null;
        if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
        if (this.checkTimerId) clearInterval(this.checkTimerId);
        if (this.responseTimerId) clearTimeout(this.responseTimerId);
        this.clearSession();

        const endModalEl = document.getElementById('endTrackingModal');
        bootstrap.Modal.getInstance(endModalEl)?.hide();
        location.reload();
    }

    // ── Notification helpers ──────────────────────────────────────────────
    showNotification(title, message, type = 'info') {
        const modalEl  = document.getElementById('notificationModal');
        const titleEl  = document.getElementById('notificationTitle');
        const messageEl= document.getElementById('notificationMessage');
        const iconEl   = document.getElementById('notificationIcon');
        if (!modalEl || !titleEl || !messageEl || !iconEl) { alert(`${title}: ${message}`); return; }

        titleEl.textContent   = title;
        messageEl.textContent = message;

        const map = {
            success: ['<i class="fas fa-check-circle"></i>', '#28a745'],
            error:   ['<i class="fas fa-times-circle"></i>',  '#dc3545'],
            warning: ['<i class="fas fa-exclamation-triangle"></i>', '#ffc107'],
            info:    ['<i class="fas fa-info-circle"></i>', '#17a2b8'],
        };
        const [icon, color] = map[type] || map.info;
        iconEl.innerHTML  = icon;
        iconEl.style.color = color;

        new bootstrap.Modal(modalEl).show();
    }

    showToast(title, message) {
        const toastEl   = document.getElementById('notificationToast');
        const toastTitle = document.getElementById('toastTitle');
        const toastMsg  = document.getElementById('toastMessage');
        if (!toastEl) return;
        if (toastTitle) toastTitle.textContent = title;
        if (toastMsg)   toastMsg.textContent   = message;
        new bootstrap.Toast(toastEl).show();
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Global Google Maps callback (used by the Maps script tag)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function initMap() {
    if (window.safetyTracker) {
        window.safetyTracker.initMap();
    } else {
        // Maps loaded before DOMContentLoaded finished – queue it
        window._mapPending = true;
    }
}
window.gm_authFailure = function () { console.error('Google Maps auth failure'); };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Boot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
document.addEventListener('DOMContentLoaded', () => {
    window.safetyTracker = new SafetyTracker();
    // If Maps already fired initMap() before we were ready
    if (window._mapPending) {
        window.safetyTracker.initMap();
        delete window._mapPending;
    }
});