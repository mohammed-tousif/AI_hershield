// Live Safety Tracker Logic

const API_BASE_URL = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : '';

/**
 * Parse JSON from fetch responses. Fails clearly on HTML error pages or empty bodies.
 */
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

console.log('Live Tracker Script Loaded');

class SafetyTracker {
    constructor() {
        console.log('SafetyTracker Constructor Called');
        this.sessionId = null;
        this.pin = null;
        this.verifyInterval = 60000; // Default 2 mins
        this.pinTimeout = 10000;      // Default 20 secs
        this.nextCheckTime = null;
        this.checkTimerId = null;
        this.responseTimerId = null;
        this.watchId = null;
        this.isTracking = false;

        // Map elements
        this.map = null;
        this.marker = null;
        this.accuracyCircle = null;

        this.initializeEventListeners();
        // Check for existing session
        this.restoreSession();
        this.initializeMap();
    }

    initializeEventListeners() {
        console.log('Initializing Event Listeners');
        // Start Tracking Button
        const startBtn = document.getElementById('startTrackingBtn');
        if (startBtn) {
            console.log('Start button found, adding click listener');
            startBtn.addEventListener('click', (e) => {
                console.log('Start button clicked');
                this.handleStartTracking(e);
            });
        } else {
            console.error('Start tracking button NOT found');
        }

        // Confirm Safety Button (in Modal)
        const confirmBtn = document.getElementById('confirmSafety');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.handleVerifyPin());
        }

        // End Tracking Button (Show Modal)
        const endBtn = document.getElementById('endTracking');
        if (endBtn) {
            endBtn.addEventListener('click', () => {
                const modal = new bootstrap.Modal(document.getElementById('endTrackingModal'));
                modal.show();
            });
        }

        // Confirm End Tracking Button (Inside Modal)
        const confirmEndBtn = document.getElementById('confirmEndTrackingBtn');
        if (confirmEndBtn) {
            confirmEndBtn.addEventListener('click', () => this.handleStopTracking());
        }

        // Trigger Emergency Button
        const emergencyBtn = document.getElementById('triggerEmergencyBtn');
        if (emergencyBtn) {
            emergencyBtn.addEventListener('click', () => {
                const modal = new bootstrap.Modal(document.getElementById('sosModal'));
                modal.show();
            });
        }

        // Confirm SOS Button (Inside Modal)
        const confirmSosBtn = document.getElementById('confirmSosBtn');
        if (confirmSosBtn) {
            confirmSosBtn.addEventListener('click', () => {
                const modalEl = document.getElementById('sosModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                modal.hide();
                this.triggerEmergency();
            });
        }
    }

    async initializeMap() {
        const mapElement = document.getElementById('map');
        if (!mapElement || typeof google === 'undefined' || !google.maps) return;

        // Default center (will be updated)
        const defaultPos = { lat: 15.3647, lng: 75.1240 }; // Hubli

        this.map = new google.maps.Map(mapElement, {
            zoom: 15,
            center: defaultPos,
            mapTypeId: google.maps.MapTypeId.ROADMAP
        });

        this.marker = new google.maps.Marker({
            map: this.map,
            position: defaultPos,
            title: 'Your Location',
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: '#9B8EC7',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#FFFFFF'
            }
        });
    }

    async handleStartTracking(e) {
        console.log('handleStartTracking called');
        e.preventDefault();

        // Fetch user name from localStorage (set during login)
        const name = localStorage.getItem('hershield_user_name') ||
            (localStorage.getItem('hershield_user_email') ?
                localStorage.getItem('hershield_user_email').split('@')[0] : 'User');

        let savedContacts = [];
        try {
            const raw = localStorage.getItem('hershield_emergency_contacts') || '[]';
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) savedContacts = parsed;
        } catch {
            savedContacts = [];
        }
        const emergencyContacts = savedContacts.map((contact) => contact.email).filter(Boolean);
        const startPoint = document.getElementById('startPoint').value;
        const destination = document.getElementById('destination').value;
        const transportMode = document.getElementById('transportMode').value;
        const pin = document.getElementById('pin').value;

        console.log('Form Data:', { name, emergencyContacts, startPoint, destination, transportMode, pin });

        if (!pin || !transportMode) {
            console.warn('Validation failed: Missing fields');
            this.showNotification('Missing Information', 'Please fill in all required fields, including Transport Mode.', 'warning');
            return;
        }

        if (emergencyContacts.length === 0) {
            console.warn('Validation failed: No emergency contacts');
            this.showNotification('No Emergency Contacts', 'Please add emergency contacts from the sidebar before starting tracking.', 'warning');
            return;
        }

        if (pin.length !== 6 || isNaN(pin)) {
            console.warn('Validation failed: Invalid PIN');
            this.showNotification('Invalid PIN', 'PIN must be a 6-digit number.', 'warning');
            return;
        }

        if (!API_BASE_URL) {
            this.showNotification(
                'Configuration Error',
                'This page must be opened in a browser from your Her Shield server URL.',
                'error'
            );
            return;
        }

        try {
            try {
                console.log('Checking server health...');
                const healthCheck = await fetch(`${API_BASE_URL}/api/health`);
                if (!healthCheck.ok) {
                    throw new Error(`Health check failed (HTTP ${healthCheck.status})`);
                }
                console.log('Server health check passed');
            } catch (error) {
                console.error('Server health check failed:', error);
                this.showNotification(
                    'Connection Error',
                    'Cannot reach the API. Start the Her Shield server and open this page from the same URL (same host and port), e.g. http://localhost:3000/live-tracker.html.',
                    'error'
                );
                return;
            }

            console.log('Sending start request to server...');
            const response = await fetch(`${API_BASE_URL}/api/live-tracker/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name, emergencyContacts, source: startPoint, destination, transportMode, pin
                })
            });

            let data;
            try {
                data = await readJsonResponse(response);
            } catch (err) {
                console.error('Start session response:', err);
                this.showNotification('Connection Error', err.message, 'error');
                return;
            }

            if (!response.ok || !data.success) {
                this.showNotification(
                    'Error',
                    data.message || `Failed to start tracking (HTTP ${response.status})`,
                    'error'
                );
                return;
            }

            console.log('Server response:', data);

            this.sessionId = data.sessionId;
            this.pin = pin;
            this.verifyInterval = data.verifyInterval;
            this.pinTimeout = data.pinTimeout;

            this.saveSession({
                sessionId: this.sessionId,
                pin: this.pin,
                verifyInterval: this.verifyInterval,
                pinTimeout: this.pinTimeout,
                startTime: Date.now()
            });

            this.startTrackingSession();
        } catch (error) {
            console.error('Error starting tracking:', error);
            this.showNotification('Error', error.message || 'Server error. Please try again.', 'error');
        }
    }

    saveSession(data) {
        localStorage.setItem('safetyTrackerSession', JSON.stringify(data));
    }

    restoreSession() {
        const savedSession = localStorage.getItem('safetyTrackerSession');
        if (savedSession) {
            try {
                const data = JSON.parse(savedSession);
                // Optional: Check if session is too old (e.g., > 24 hours)
                if (Date.now() - data.startTime > 86400000) {
                    this.clearSession();
                    return;
                }

                console.log('Restoring session:', data);
                this.sessionId = data.sessionId;
                this.pin = data.pin;
                this.verifyInterval = data.verifyInterval;
                this.pinTimeout = data.pinTimeout;

                this.startTrackingSession();
                this.showToast('Session Restored', 'Resuming your live tracking session.');
            } catch (e) {
                console.error('Error restoring session:', e);
                this.clearSession();
            }
        }
    }

    clearSession() {
        localStorage.removeItem('safetyTrackerSession');
    }

    startTrackingSession() {
        this.isTracking = true;

        const initialForm = document.getElementById('initialForm');
        const trackingView = document.getElementById('trackingView');
        if (initialForm) initialForm.style.display = 'none';
        if (trackingView) trackingView.style.display = 'block';

        // Fix map rendering issues when showing hidden container
        if (this.map) {
            google.maps.event.trigger(this.map, 'resize');
            if (this.marker) {
                this.map.panTo(this.marker.getPosition());
                this.map.setZoom(15);
            }
        }

        // Start Geolocation
        if (navigator.geolocation) {
            this.watchId = navigator.geolocation.watchPosition(
                (pos) => this.handleLocationUpdate(pos),
                (err) => console.error('Geolocation error:', err),
                { enableHighAccuracy: true }
            );
        }

        // Start Verification Timer
        this.resetVerificationTimer();

        // Prevent accidental reload
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

        // Update Map
        if (this.map && this.marker) {
            const pos = { lat, lng };
            this.marker.setPosition(pos);
            this.map.panTo(pos);
        }

        // Send to Backend
        try {
            await fetch(`${API_BASE_URL}/api/live-tracker/update-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.sessionId,
                    lat,
                    lng
                })
            });
        } catch (error) {
            console.error('Error updating location:', error);
        }
    }

    resetVerificationTimer() {
        if (this.checkTimerId) clearInterval(this.checkTimerId);

        let timeLeft = this.verifyInterval / 1000;
        const countdownEl = document.getElementById('countdown');
        if (!countdownEl) {
            console.warn('countdown element not found');
            return;
        }

        this.checkTimerId = setInterval(() => {
            if (!this.isTracking) return;

            timeLeft--;
            const minutes = Math.floor(timeLeft / 60);
            const seconds = Math.floor(timeLeft % 60);
            countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            if (timeLeft <= 0) {
                clearInterval(this.checkTimerId);
                this.showPinModal();
            }
        }, 1000);
    }

    showPinModal() {
        const modalEl = document.getElementById('safetyCheckModal');
        if (!modalEl) return;
        const modal = new bootstrap.Modal(modalEl);
        modal.show();

        // Play sound
        const audio = document.getElementById('alertSound');
        if (audio) audio.play().catch(e => console.log('Audio play failed', e));

        // Start Response Timer (Timeout)
        if (this.responseTimerId) clearTimeout(this.responseTimerId);

        this.responseTimerId = setTimeout(() => {
            if (modalEl.classList.contains('show')) {
                // User failed to respond in time
                modal.hide(); // Or keep open?
                this.triggerEmergency();
            }
        }, this.pinTimeout);
    }

    async handleVerifyPin() {
        const inputEl = document.getElementById('safetyCodeInput');
        const errorDiv = document.getElementById('codeError');
        if (!inputEl || !errorDiv) return;

        const inputPin = inputEl.value;

        if (inputPin !== this.pin) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = 'Incorrect PIN!';
            return;
        }

        // Correct PIN
        try {
            const response = await fetch(`${API_BASE_URL}/api/live-tracker/verify-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.sessionId,
                    pin: inputPin
                })
            });

            let data;
            try {
                data = await readJsonResponse(response);
            } catch (error) {
                console.error('Error verifying PIN:', error);
                errorDiv.style.display = 'block';
                errorDiv.textContent = error.message || 'Network error';
                return;
            }

            if (!response.ok || !data.success) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = data.message || 'Verification failed';
                return;
            }

            errorDiv.style.display = 'none';
            inputEl.value = '';

            const modalEl = document.getElementById('safetyCheckModal');
            const modal = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
            if (modal) modal.hide();

            if (this.responseTimerId) clearTimeout(this.responseTimerId);

            this.showToast('Safety Confirmed', 'Next check in 2 minutes.');
            this.resetVerificationTimer();
        } catch (error) {
            console.error('Error verifying PIN:', error);
        }
    }

    async triggerEmergency() {
        if (!this.sessionId) {
            console.error('No active session ID found');
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
            console.log('Triggering emergency for session:', this.sessionId);
            const response = await fetch(`${API_BASE_URL}/api/live-tracker/trigger-alert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.sessionId })
            });

            const data = await readJsonResponse(response);
            console.log('Emergency response:', data);

            if (!response.ok || !data.success) {
                throw new Error(data.message || `Server error (HTTP ${response.status})`);
            }

            this.showNotification(
                'Emergency Alert Sent',
                'Your contacts have been notified via email with your location and trip details.',
                'success'
            );
        } catch (error) {
            console.error('Error triggering alert:', error);
            this.showNotification('Alert Failed', `Failed to send emergency alert: ${error.message}. Please call for help immediately!`, 'error');
        }
    }

    async handleStopTracking() {
        const endPinEl = document.getElementById('endTrackingPin');
        const errorDiv = document.getElementById('endTrackingError');
        if (!endPinEl || !errorDiv) return;

        const inputPin = endPinEl.value;

        if (inputPin !== this.pin) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = 'Incorrect PIN!';
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/live-tracker/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.sessionId,
                    pin: inputPin
                })
            });

            let data;
            try {
                data = await readJsonResponse(response);
            } catch (error) {
                console.error('Error stopping tracking:', error);
                this.showNotification('Error', error.message, 'error');
                return;
            }

            if (!response.ok || !data.success) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = data.message || `Could not stop session (HTTP ${response.status})`;
                return;
            }

            this.isTracking = false;
            if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
            if (this.checkTimerId) clearInterval(this.checkTimerId);
            if (this.responseTimerId) clearTimeout(this.responseTimerId);

            // Clear session from localStorage
            this.clearSession();

            // Hide modal
            const endModalEl = document.getElementById('endTrackingModal');
            const endModal = endModalEl ? bootstrap.Modal.getInstance(endModalEl) : null;
            if (endModal) endModal.hide();

            location.reload(); // Reset page
        } catch (error) {
            console.error('Error stopping tracking:', error);
            this.showNotification('Error', 'Failed to stop tracking. Please try again.', 'error');
        }
    }

    showNotification(title, message, type = 'info') {
        const modalEl = document.getElementById('notificationModal');
        const titleEl = document.getElementById('notificationTitle');
        const messageEl = document.getElementById('notificationMessage');
        const iconEl = document.getElementById('notificationIcon');
        if (!modalEl || !titleEl || !messageEl || !iconEl) {
            console.warn('notificationModal markup missing:', title, message);
            return;
        }

        titleEl.textContent = title;
        messageEl.textContent = message;

        // Set icon based on type
        let iconHtml = '';
        let color = '';
        switch (type) {
            case 'success':
                iconHtml = '<i class="fas fa-check-circle"></i>';
                color = '#28a745';
                break;
            case 'error':
                iconHtml = '<i class="fas fa-times-circle"></i>';
                color = '#9B8EC7';
                break;
            case 'warning':
                iconHtml = '<i class="fas fa-exclamation-triangle"></i>';
                color = '#ffc107';
                break;
            default:
                iconHtml = '<i class="fas fa-info-circle"></i>';
                color = '#17a2b8';
        }

        iconEl.innerHTML = iconHtml;
        iconEl.style.color = color;

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }

    showToast(title, message) {
        const toastEl = document.getElementById('notificationToast');
        const toastTitle = document.getElementById('toastTitle');
        const toastMessage = document.getElementById('toastMessage');
        if (!toastEl || !toastTitle || !toastMessage) return;
        toastTitle.textContent = title;
        toastMessage.textContent = message;
        const toast = new bootstrap.Toast(toastEl);
        toast.show();
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    window.safetyTracker = new SafetyTracker();
});