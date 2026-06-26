/**
 * Emergency SOS System
 * Handles emergency alert triggers, location sharing, and contact management
 */

class EmergencySystem {
    constructor() {
        this.isEmergencyActive = false;
        this.currentLocation = null;
        this.userId = null;
        this.sessionId = null;
        this.cooldownPeriod = 5000; // 5 seconds cooldown
        this.lastTrigger = 0;

        this.init();
    }

    init() {
        // Get user ID from localStorage or session
        this.userId = localStorage.getItem('hershield_user_uid')
            || localStorage.getItem('hershield_backend_user_id')
            || localStorage.getItem('userId');

        // Set up emergency button listeners
        this.setupEmergencyButtons();

        // Start location tracking
        this.startLocationTracking();
    }

    setupEmergencyButtons() {
        // Main emergency button
        const emergencyBtn = document.getElementById('emergencyBtn');
        if (emergencyBtn) {
            emergencyBtn.addEventListener('click', () => this.triggerEmergency());
        }

        // Alternative emergency buttons
        document.querySelectorAll('.emergency-trigger').forEach(btn => {
            btn.addEventListener('click', () => this.triggerEmergency());
        });

        // Emergency contact management
        const addContactBtn = document.getElementById('addEmergencyContact');
        if (addContactBtn) {
            addContactBtn.addEventListener('click', () => this.showAddContactModal());
        }
    }

    startLocationTracking() {
        if ('geolocation' in navigator) {
            navigator.geolocation.watchPosition(
                (position) => {
                    this.currentLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: new Date()
                    };
                },
                (error) => {
                    console.error('Location tracking error:', error);
                    this.showNotification('Unable to access location. Please enable location services.', 'warning');
                },
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0
                }
            );
        } else {
            this.showNotification('Geolocation is not supported by your browser', 'error');
        }
    }

    async triggerEmergency() {
        // Check cooldown
        const now = Date.now();
        if (now - this.lastTrigger < this.cooldownPeriod) {
            this.showNotification('Please wait before triggering another alert', 'warning');
            return;
        }

        // Confirm emergency
        const confirmed = await this.confirmEmergency();
        if (!confirmed) return;

        this.lastTrigger = now;
        this.isEmergencyActive = true;

        // Show loading state
        this.showLoadingState();

        try {
            // Get current location
            if (!this.currentLocation) {
                await this.getCurrentLocation();
            }

            // Get session ID if in tracking mode
            this.sessionId = localStorage.getItem('currentSessionId');

            // Send emergency alert
            const response = await fetch('/api/emergency/trigger', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    location: this.currentLocation,
                    sessionId: this.sessionId,
                    message: 'Emergency SOS triggered'
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccessState(data);

                // Play alert sound
                this.playAlertSound();

                // Vibrate if supported
                if ('vibrate' in navigator) {
                    navigator.vibrate([200, 100, 200, 100, 200]);
                }

                // Emit socket event if connected
                if (window.socket && window.socket.connected) {
                    window.socket.emit('emergency', {
                        sessionId: this.sessionId,
                        location: this.currentLocation
                    });
                }
            } else {
                throw new Error(data.error || 'Failed to send emergency alert');
            }

        } catch (error) {
            console.error('Emergency trigger error:', error);
            this.showErrorState(error.message);
        }
    }

    async confirmEmergency() {
        return new Promise((resolve) => {
            // Create confirmation modal
            const modal = document.createElement('div');
            modal.className = 'emergency-confirm-modal';
            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="modal-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h3>Trigger Emergency SOS?</h3>
                    <p>This will immediately alert all your emergency contacts with your current location.</p>
                    <div class="modal-actions">
                        <button class="btn btn-secondary cancel-btn">Cancel</button>
                        <button class="btn btn-danger confirm-btn">Trigger SOS</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                .emergency-confirm-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .emergency-confirm-modal .modal-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(5px);
                }
                .emergency-confirm-modal .modal-content {
                    position: relative;
                    background: white;
                    padding: 2rem;
                    border-radius: 20px;
                    max-width: 400px;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    animation: modalSlideIn 0.3s ease;
                }
                @keyframes modalSlideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-50px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .emergency-confirm-modal .modal-icon {
                    font-size: 4rem;
                    color: #9B8EC7;
                    margin-bottom: 1rem;
                    animation: pulse 1s infinite;
                }
                .emergency-confirm-modal .modal-actions {
                    display: flex;
                    gap: 1rem;
                    margin-top: 1.5rem;
                }
                .emergency-confirm-modal .modal-actions button {
                    flex: 1;
                }
            `;
            document.head.appendChild(style);

            // Handle buttons
            modal.querySelector('.cancel-btn').addEventListener('click', () => {
                modal.remove();
                style.remove();
                resolve(false);
            });

            modal.querySelector('.confirm-btn').addEventListener('click', () => {
                modal.remove();
                style.remove();
                resolve(true);
            });

            // Close on overlay click
            modal.querySelector('.modal-overlay').addEventListener('click', () => {
                modal.remove();
                style.remove();
                resolve(false);
            });
        });
    }

    async getCurrentLocation() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.currentLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    };
                    resolve(this.currentLocation);
                },
                (error) => {
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }

    showLoadingState() {
        this.showNotification('🚨 Sending emergency alerts...', 'info', 0);
    }

    showSuccessState(data) {
        const message = `✅ Emergency alerts sent to ${data.alertsSent} contact(s)!`;
        this.showNotification(message, 'success', 5000);

        // Show detailed results if available
        if (data.results && data.results.length > 0) {
            console.log('Emergency alert results:', data.results);
        }
    }

    showErrorState(errorMessage) {
        this.showNotification(`❌ Error: ${errorMessage}`, 'error', 5000);
        this.isEmergencyActive = false;
    }

    showNotification(message, type = 'info', duration = 3000) {
        // Remove existing notifications
        document.querySelectorAll('.emergency-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = `emergency-notification ${type}`;
        notification.textContent = message;

        const styles = {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '1rem 1.5rem',
            borderRadius: '12px',
            background: type === 'success' ? '#10b981' :
                type === 'error' ? '#ef4444' :
                    type === 'warning' ? '#f59e0b' : '#3b82f6',
            color: 'white',
            fontWeight: '500',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
            zIndex: '10001',
            animation: 'slideInRight 0.3s ease',
            maxWidth: '400px'
        };

        Object.assign(notification.style, styles);
        document.body.appendChild(notification);

        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        }
    }

    playAlertSound() {
        // Create audio context for alert sound
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.log('Audio not supported:', error);
        }
    }

    async shareLocation() {
        if (!this.currentLocation) {
            await this.getCurrentLocation();
        }

        try {
            const response = await fetch('/api/emergency/send-location', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    location: this.currentLocation,
                    message: 'Sharing my current location with you'
                })
            });

            const data = await response.json();

            if (data.success) {
                this.showNotification('📍 Location shared with emergency contacts', 'success');
            }
        } catch (error) {
            console.error('Error sharing location:', error);
            this.showNotification('Failed to share location', 'error');
        }
    }
}

// Initialize emergency system when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.emergencySystem = new EmergencySystem();
    });
} else {
    window.emergencySystem = new EmergencySystem();
}

// Add CSS animations
const animationStyles = document.createElement('style');
animationStyles.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
    @keyframes pulse {
        0%, 100% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.1);
        }
    }
`;
document.head.appendChild(animationStyles);
