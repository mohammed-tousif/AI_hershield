// Navigation and Authentication Management - Unified Navigation System
class NavigationManager {
    constructor(options = {}) {
        this.isLoggedIn = this.checkLoginStatus();
        this.currentPage = this.getCurrentPage();
        this.mobileMenuOpen = false;
        this.hasFirebaseNav = options.firebase || false;
        this.init();
    }

    init() {
        this.ensureFontAwesome();
        this.createNavigation();
        this.handleAuthenticationRedirect();
        this.updateNavState();
        this.setupBrowserNavigationHandlers();
    }

    ensureFontAwesome() {
        // Check if Font Awesome is already loaded
        const faLink = document.querySelector('link[href*="font-awesome"]');
        if (!faLink) {
            // Add Font Awesome if not present
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css';
            document.head.appendChild(link);
        }
    }

    checkLoginStatus() {
        // Check both Firebase auth state and localStorage fallback
        return localStorage.getItem('hershield_logged_in') === 'true' || this.isLoggedIn;
    }

    setLoginStatus(status) {
        localStorage.setItem('hershield_logged_in', status.toString());
        this.isLoggedIn = status;
    }

    getCurrentPage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';

        // Map filenames to page types
        if (filename === 'index.html') return 'landing';
        if (filename === 'dashboard.html') return 'dashboard';
        if (filename === 'safety-map.html') return 'safety-map';
        if (filename === 'live-tracker.html') return 'live-tracker';
        if (filename === 'community.html') return 'community';
        if (filename === 'auth.html') return 'auth';

        return 'unknown';
    }

    handleAuthenticationRedirect() {
        const publicPages = ['landing', 'auth'];
        const protectedPages = ['dashboard', 'safety-map', 'live-tracker', 'community'];

        console.log('🔄 handleAuthenticationRedirect checking...', {
            page: this.currentPage,
            hasAuthService: !!window.authService
        });

        // Wait for Firebase auth to initialize if available
        if (window.authService) {
            // Add a delay to ensure Firebase auth state is fully loaded
            setTimeout(() => {
                this.performRedirectCheck(protectedPages);
            }, 1000); // Increased to 1000ms
        } else {
            this.performRedirectCheck(protectedPages);
        }
    }

    performRedirectCheck(protectedPages) {
        // Check both Firebase auth and localStorage
        const localAuth = this.checkLoginStatus();
        const firebaseAuth = window.authService && window.authService.isLoggedIn();
        const isAuthenticated = localAuth || firebaseAuth;

        console.log('🔒 Auth Check:', {
            page: this.currentPage,
            isAuthenticated,
            localAuth,
            firebaseAuth,
            localStorageValue: localStorage.getItem('hershield_logged_in')
        });

        if (protectedPages.includes(this.currentPage) && !isAuthenticated) {
            console.warn('⛔ Access denied. Redirecting to auth.html');
            // Redirect to auth page if not logged in - use replace to prevent back
            window.location.replace('auth.html');
            return;
        }

        if ((this.currentPage === 'landing' || this.currentPage === 'auth') && isAuthenticated) {
            console.log('✅ Already logged in. Redirecting to dashboard.html');
            // Redirect to dashboard if already logged in - use replace to prevent back
            window.location.replace('dashboard.html');
            return;
        }
    }

    setupBrowserNavigationHandlers() {
        // Listen for browser back/forward navigation
        window.addEventListener('popstate', () => {
            this.handleBrowserNavigation();
        });

        // Listen for page show (handles bfcache - back/forward cache)
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                // Page was loaded from cache, re-check auth
                this.handleBrowserNavigation();
            }
        });
    }

    handleBrowserNavigation() {
        // Re-check authentication status
        this.isLoggedIn = this.checkLoginStatus();
        const isAuthenticated = this.checkLoginStatus() ||
            (window.authService && window.authService.isLoggedIn());

        const protectedPages = ['dashboard', 'safety-map', 'live-tracker', 'community'];

        // If on protected page and not authenticated, redirect to auth
        if (protectedPages.includes(this.currentPage) && !isAuthenticated) {
            window.location.replace('auth.html'); // Use replace to prevent back
            return;
        }

        // If on auth/landing page and authenticated, redirect to dashboard
        if ((this.currentPage === 'auth' || this.currentPage === 'landing') && isAuthenticated) {
            window.location.replace('dashboard.html'); // Use replace to prevent back
            return;
        }
    }

    login(email, password) {
        // Simulate login - in real app, this would call an API
        if (email && password) {
            this.setLoginStatus(true);
            // Store user info
            localStorage.setItem('hershield_user_email', email);
            return true;
        }
        return false;
    }

    logout() {
        // Use Firebase auth service if available, otherwise fallback to localStorage
        if (window.authService) {
            window.authService.logout();
        } else {
            this.setLoginStatus(false);
            localStorage.removeItem('hershield_user_email');
            window.location.href = 'index.html';
        }
    }

    createNavigation() {
        if (this.currentPage === 'landing' || this.currentPage === 'auth') {
            return; // Don't show nav on landing/auth pages
        }

        // Use a consistent sidebar navigation system
        const navHtml = `
            <!-- UNIFIED NAVIGATION SYSTEM -->
            <div class="hershield-unified-nav">
                <!-- Fixed Navigation Buttons for Mobile -->
                <button id="fixedSidebarToggle" class="fixed-nav-btn fixed-nav-btn-sidebar">
                    <svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
                </button>
                <button id="fixedActionsToggle" class="fixed-nav-btn fixed-nav-btn-actions">
                    <svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
                </button>

                <!-- Sidebar Navigation -->
                <div class="hershield-sidebar" id="sidebar">
                    <div class="sidebar-header-mobile">
                        <h5 style="margin: 0; color: #FF9A86;">Menu</h5>
                        <button class="sidebar-close-btn" id="sidebarCloseBtn">
                            <svg viewBox="0 0 24 24" fill="currentColor" style="width: 24px; height: 24px;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                    </div>
                    
                    <button type="button" class="sidebar-profile sidebar-profile-btn" id="sidebarProfileBtn" title="Edit your profile">
                        <img src="${localStorage.getItem('hershield_user_avatar') || 'https://i.pravatar.cc/150?img=32'}" alt="User Avatar" class="profile-avatar">
                        <div class="profile-info">
                            <h6 class="profile-name">${localStorage.getItem('hershield_user_name') || localStorage.getItem('hershield_user_email')?.split('@')[0] || 'Her Shield User'}</h6>
                            <small class="profile-role">Tap to edit profile</small>
                        </div>
                        <i class="fas fa-chevron-right ms-auto text-muted small profile-chevron" aria-hidden="true"></i>
                    </button>

                    <nav class="sidebar-nav">
                        <a href="dashboard.html" class="sidebar-nav-link ${this.currentPage === 'dashboard' ? 'active' : ''}">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
                            <span>Dashboard</span>
                        </a>
                        <a href="safety-map.html" class="sidebar-nav-link ${this.currentPage === 'safety-map' ? 'active' : ''}">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                            <span>Safety Map</span>
                        </a>
                        <a href="live-tracker.html" class="sidebar-nav-link ${this.currentPage === 'live-tracker' ? 'active' : ''}">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>
                            <span>Live Tracker</span>
                        </a>
                        <a href="community.html" class="sidebar-nav-link ${this.currentPage === 'community' ? 'active' : ''}">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                            <span>Community</span>
                        </a>
                        <a href="#" class="sidebar-nav-link" id="emergencyContactsBtn">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                            <span>Emergency Contacts</span>
                        </a>
                        <!-- Emergency Alert Button — highlighted red -->
                        <a href="#" class="sidebar-nav-link sos-nav-btn" id="sosNavBtn">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                            <span>Emergency Alert</span>
                            <span class="sos-active-badge" id="sosSidebarBadge" style="display:none;">SOS ACTIVE</span>
                        </a>
                    </nav>

                    <div class="sidebar-footer">
                        <a href="auth.html" class="logout-btn">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
                            <span>Logout</span>
                        </a>
                    </div>
                </div>

                <!-- Mobile Overlay -->
                <div class="mobile-overlay" id="mobileOverlay"></div>

                <!-- Quick Actions Panel -->
                <div class="quick-actions-panel" id="quickActionsPanel">
                    <div class="actions-header">
                        <h5 class="mb-0">Quick Actions</h5>
                        <button class="btn-close" id="closeQuickActions"></button>
                    </div>
                    <div class="actions-content">
                        <button class="action-item emergency-btn" id="quickSosBtn">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span>Emergency Alert</span>
                        </button>
                        <button class="action-item share-btn">
                            <i class="fas fa-share-alt"></i>
                            <span>Share Location</span>
                        </button>
                        <button class="action-item call-btn">
                            <i class="fas fa-phone"></i>
                            <span>Call Emergency</span>
                        </button>
                        <button class="action-item route-btn">
                            <i class="fas fa-route"></i>
                            <span>Safe Route</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- ══════════════════ SOS ALERT MODAL ══════════════════ -->
            <div class="modal fade" id="sosAlertModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content border-0 shadow-lg" style="border-radius:24px;overflow:hidden;">
                        <div class="modal-header border-0 text-white" style="background:linear-gradient(135deg,#FF453A,#c0392b);">
                            <h5 class="modal-title fw-bold"><i class="fas fa-exclamation-triangle me-2"></i>Emergency Alert</h5>
                            <button type="button" class="btn-close btn-close-white" id="sosModalCloseBtn"></button>
                        </div>
                        <div class="modal-body p-4">
                            <!-- STEP 1: Setup (idle state) -->
                            <div id="sosStep1">
                                <p class="text-muted mb-3 small">Sending this alert will share your live location with all your emergency contacts until you tap <strong>"I'm Safe"</strong> or the timer runs out.</p>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Security PIN <span class="text-danger">*</span></label>
                                    <p class="text-muted small mb-2">You'll need this 4-digit PIN to confirm you're safe and stop sharing your location.</p>
                                    <div class="d-flex gap-2 align-items-center">
                                        <input type="password" class="form-control sos-pin-input" id="sosPinInput"
                                            maxlength="4" placeholder="••••" inputmode="numeric" pattern="[0-9]{4}" autocomplete="off"
                                            style="letter-spacing:0.5em;font-size:1.4rem;text-align:center;max-width:120px;">
                                        <button type="button" class="btn btn-outline-secondary btn-sm" id="sosGeneratePinBtn" title="Generate random PIN">
                                            <i class="fas fa-dice me-1"></i>Generate
                                        </button>
                                    </div>
                                    <div id="sosPinDisplay" class="mt-2 p-2 rounded text-center fw-bold" style="display:none;background:rgba(255,69,58,0.08);color:#c0392b;font-size:1.1rem;letter-spacing:0.3em;"></div>
                                </div>
                                <div class="mb-4">
                                    <label class="form-label fw-bold">Auto-stop Timer <span class="text-muted fw-normal small">(optional)</span></label>
                                    <select class="form-select" id="sosTimerSelect">
                                        <option value="">No auto-stop (manual only)</option>
                                        <option value="15">15 minutes</option>
                                        <option value="30">30 minutes</option>
                                        <option value="45">45 minutes</option>
                                        <option value="60">1 hour</option>
                                        <option value="90">1.5 hours</option>
                                        <option value="120">2 hours</option>
                                    </select>
                                    <div class="form-text">Location sharing will stop automatically after this time, even if you don't tap "I'm Safe".</div>
                                </div>
                                <div id="sosFeedback" class="alert d-none mb-3" role="alert"></div>
                                <div class="d-grid">
                                    <button type="button" class="btn sos-trigger-btn py-3" id="sosTriggerBtn">
                                        <i class="fas fa-exclamation-triangle me-2"></i><strong>SEND EMERGENCY ALERT</strong>
                                    </button>
                                </div>
                            </div>

                            <!-- STEP 2: Active SOS state -->
                            <div id="sosStep2" style="display:none;">
                                <div class="text-center mb-4">
                                    <div class="sos-pulse-circle mx-auto mb-3">
                                        <i class="fas fa-broadcast-tower" style="font-size:2rem;color:white;"></i>
                                    </div>
                                    <h5 class="fw-bold text-danger">🔴 SOS ACTIVE</h5>
                                    <p class="text-muted small mb-1">Sharing live location with <strong id="sosContactCount">0</strong> contact(s)</p>
                                    <p class="text-muted small" id="sosTimerDisplay"></p>
                                </div>
                                <div class="alert alert-warning small d-flex align-items-start gap-2" role="alert">
                                    <i class="fas fa-shield-alt mt-1"></i>
                                    <span>Keep this app open to continue sharing your live location. Your contacts have a link to track you in real time.</span>
                                </div>
                                <div class="d-grid">
                                    <button type="button" class="btn btn-success py-3" id="imSafeBtn">
                                        <i class="fas fa-check-circle me-2"></i><strong>I'M SAFE — Stop Sharing</strong>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ══════════════════ I'M SAFE PIN CONFIRM MODAL ══════════════════ -->
            <div class="modal fade" id="imSafeModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
                <div class="modal-dialog modal-dialog-centered modal-sm">
                    <div class="modal-content border-0 shadow-lg" style="border-radius:20px;">
                        <div class="modal-header border-0" style="background:linear-gradient(135deg,#34C759,#27ae60);">
                            <h6 class="modal-title fw-bold text-white"><i class="fas fa-lock me-2"></i>Confirm You're Safe</h6>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body p-4 text-center">
                            <p class="text-muted small mb-3">Enter your 4-digit security PIN to confirm you're safe and stop sharing your location.</p>
                            <input type="password" class="form-control mb-1" id="imSafePinInput"
                                maxlength="4" placeholder="Enter PIN" inputmode="numeric"
                                style="letter-spacing:0.5em;font-size:1.5rem;text-align:center;">
                            <div id="imSafePinError" class="text-danger small mb-3" style="min-height:1.2em;"></div>
                            <div class="d-grid">
                                <button type="button" class="btn btn-success py-2" id="imSafeConfirmBtn">
                                    <i class="fas fa-check-circle me-2"></i>Confirm Safe
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Emergency Contacts Modal -->
            <div class="modal fade" id="emergencyContactsModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content border-0 shadow-lg" style="border-radius: 24px;">
                        <div class="modal-header border-0 text-white" style="background: linear-gradient(135deg, var(--gradient-start), var(--gradient-middle));">
                            <h5 class="modal-title fw-bold">Emergency Contacts</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body p-4">
                            <p class="text-muted mb-4">Add trusted contacts to be notified in case of an emergency.</p>
                            <form id="emergencyContactsForm">
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Contact Name *</label>
                                    <input type="text" class="form-control" id="contactName" placeholder="Full name" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Relationship *</label>
                                    <select class="form-select" id="contactRelationship" required>
                                        <option value="" disabled selected>Select relationship</option>
                                        <optgroup label="Family">
                                            <option value="Mother">Mother</option>
                                            <option value="Father">Father</option>
                                            <option value="Sister">Sister</option>
                                            <option value="Brother">Brother</option>
                                            <option value="Husband">Husband</option>
                                            <option value="Wife">Wife</option>
                                            <option value="Daughter">Daughter</option>
                                            <option value="Son">Son</option>
                                            <option value="Grandmother">Grandmother</option>
                                            <option value="Grandfather">Grandfather</option>
                                            <option value="Aunt">Aunt</option>
                                            <option value="Uncle">Uncle</option>
                                            <option value="Cousin">Cousin</option>
                                        </optgroup>
                                        <optgroup label="Friends &amp; Others">
                                            <option value="Close Friend">Close Friend</option>
                                            <option value="Best Friend">Best Friend"</option>
                                            <option value="Roommate">Roommate</option>
                                            <option value="Colleague">Colleague</option>
                                            <option value="Neighbour">Neighbour</option>
                                            <option value="Guardian">Guardian</option>
                                            <option value="Other">Other</option>
                                        </optgroup>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Phone Number <span class="text-muted fw-normal">(for SMS alerts)</span></label>
                                    <input type="tel" class="form-control" id="contactPhone" placeholder="+91 98765 43210 or 9876543210">
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Email Address <span class="text-muted fw-normal">(for email alerts)</span></label>
                                    <input type="email" class="form-control" id="contactEmail" placeholder="example@email.com">
                                    <div class="form-text">At least one of phone or email is required.</div>
                                </div>
                                <div class="d-grid gap-2">
                                    <button type="submit" class="btn btn-primary" style="background: var(--gradient-middle); border: none; border-radius: 12px;"><i class="fas fa-user-plus me-2"></i>Save Contact</button>
                                </div>
                            </form>
                            
                            <hr class="my-4">
                            
                            <h6 class="fw-bold mb-3">Saved Contacts</h6>
                            <div id="savedContactsList" class="list-group list-group-flush">
                                <!-- Contacts will be added here -->
                                <div class="text-center text-muted py-2" id="noContactsMsg">No contacts added yet.</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Profile & medical info (same modal pattern as emergency contacts) -->
            <div class="modal fade" id="profileSettingsModal" tabindex="-1" aria-labelledby="profileSettingsModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable">
                    <div class="modal-content border-0 shadow-lg" style="border-radius: 24px;">
                        <div class="modal-header border-0 text-white" style="background: linear-gradient(135deg, var(--gradient-start), var(--gradient-middle));">
                            <h5 class="modal-title fw-bold" id="profileSettingsModalLabel"><i class="fas fa-user-circle me-2"></i>Your profile</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body p-4">
                            <p class="text-muted small mb-4">Update how you appear in Her Shield and store important details for emergencies. Profile photo and extra fields are saved on this device; if you use an account linked to our server, we sync name and contact fields when possible.</p>
                            <form id="profileSettingsForm">
                                <div class="row g-3">
                                    <div class="col-md-4 text-center">
                                        <label class="form-label fw-bold d-block">Photo</label>
                                        <div class="mb-2">
                                            <img id="profilePhotoPreview" src="" alt="Preview" class="rounded-circle border" style="width: 120px; height: 120px; object-fit: cover; background: #F2EAE0;">
                                        </div>
                                        <input type="file" class="form-control form-control-sm" id="profilePhotoFile" accept="image/jpeg,image/png,image/webp,image/gif">
                                        <div class="form-text">JPG, PNG, WebP or GIF (max ~600KB recommended)</div>
                                    </div>
                                    <div class="col-md-8">
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" for="profileDisplayName">Display name</label>
                                            <input type="text" class="form-control" id="profileDisplayName" required maxlength="120" autocomplete="name">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" for="profileEmailField">Email</label>
                                            <input type="email" class="form-control" id="profileEmailField" readonly autocomplete="email">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" for="profilePhotoUrl">Photo URL <span class="text-muted fw-normal">(optional)</span></label>
                                            <input type="url" class="form-control" id="profilePhotoUrl" placeholder="https://…" autocomplete="off">
                                            <div class="form-text">Use a link instead of uploading, or leave blank to keep your current picture.</div>
                                        </div>
                                    </div>
                                </div>
                                <hr class="my-4">
                                <h6 class="fw-bold mb-3">Contact & location</h6>
                                <div class="row g-3">
                                    <div class="col-md-4">
                                        <label class="form-label fw-bold" for="profileAge">Age</label>
                                        <input type="number" class="form-control" id="profileAge" min="1" max="120" placeholder="e.g. 28">
                                    </div>
                                    <div class="col-md-8">
                                        <label class="form-label fw-bold" for="profilePersonalPhone">Personal phone</label>
                                        <input type="tel" class="form-control" id="profilePersonalPhone" placeholder="+1…" autocomplete="tel">
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold" for="profileHomeAddress">Home address</label>
                                        <textarea class="form-control" id="profileHomeAddress" rows="2" placeholder="Street, city, region — used only to help responders if you choose to share it"></textarea>
                                    </div>
                                </div>
                                <hr class="my-4">
                                <h6 class="fw-bold mb-3">Medical information <span class="text-muted small fw-normal">(optional, for emergencies)</span></h6>
                                <div class="row g-3">
                                    <div class="col-md-6">
                                        <label class="form-label fw-bold" for="profileBloodGroup">Blood group</label>
                                        <select class="form-select" id="profileBloodGroup">
                                            <option value="">Prefer not to say</option>
                                            <option>A+</option>
                                            <option>A-</option>
                                            <option>B+</option>
                                            <option>B-</option>
                                            <option>AB+</option>
                                            <option>AB-</option>
                                            <option>O+</option>
                                            <option>O-</option>
                                        </select>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold" for="profileAllergies">Allergies</label>
                                        <textarea class="form-control" id="profileAllergies" rows="2" placeholder="e.g. Penicillin, peanuts — or &quot;None&quot;"></textarea>
                                    </div>
                                    <div class="col-12">
                                        <label class="form-label fw-bold" for="profileMedications">Important medications</label>
                                        <textarea class="form-control" id="profileMedications" rows="2" placeholder="e.g. Insulin, inhaler — or &quot;None&quot;"></textarea>
                                    </div>
                                </div>
                                <div id="profileSettingsFeedback" class="alert d-none mt-3 mb-0" role="alert"></div>
                                <div class="d-grid gap-2 mt-4">
                                    <button type="submit" class="btn btn-primary py-2" style="background: var(--gradient-middle); border: none;">
                                        <i class="fas fa-save me-2"></i>Save profile
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert navigation at the top of the body
        document.body.insertAdjacentHTML('afterbegin', navHtml);

        // Add unified navigation styles
        this.addUnifiedNavStyles();

        // Initialize the unified navigation
        this.initUnifiedNav();
    }

    addUnifiedNavStyles() {
        const styleHtml = `
            <style>
        /* UNIFIED NAVIGATION SYSTEM STYLES */
        :root {
            --unified-nav-color: #FF9A86;
            --unified-nav-gradient: linear-gradient(135deg, #FF9A86 0%, #FFB399 100%);
            --sidebar-width: 280px;
            --sidebar-bg: rgba(255,255,255,0.98);
            --sidebar-border: rgba(255,154,134,0.15);
            --mobile-z-index: 10000;
        }

        /* Apply consistent font family to navigation */
        .hershield-unified-nav,
        .hershield-unified-nav *,
        .hershield-sidebar,
        .hershield-sidebar *,
        .sidebar-nav-link,
        .sidebar-nav-link *,
        .logout-btn,
        .logout-btn *,
        .fixed-nav-btn,
        .fixed-nav-btn * {
            font-family: 'Poppins', sans-serif !important;
        }

                /* Fixed Navigation Buttons */
                .fixed-nav-btn {
                    position: fixed;
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    border: none;
                    background: var(--unified-nav-gradient);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 15px rgba(255,154,134,0.35);
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-size: 1.25rem;
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                    z-index: var(--mobile-z-index);
                }

                .fixed-nav-btn:hover {
                    transform: scale(1.1);
                    box-shadow: 0 6px 20px rgba(255,154,134,0.5);
                }

                .fixed-nav-btn-sidebar {
                    top: 20px;
                    left: 20px;
                }

                .fixed-nav-btn-actions {
                    top: 20px;
                    right: 20px;
                }

                /* Sidebar */
                .hershield-sidebar {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: var(--sidebar-width);
                    height: 100vh;
                    background: var(--sidebar-bg);
                    backdrop-filter: blur(10px);
                    border-right: 1px solid var(--sidebar-border);
                    padding: 2rem 1.5rem;
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    transform: translateX(-100%);
                    transition: transform 0.3s ease;
                    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
                }

                .hershield-sidebar.active {
                    transform: translateX(0);
                }

                .sidebar-header-mobile {
                    display: none;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1rem 0;
                    margin-bottom: 1rem;
                    border-bottom: 2px solid rgba(255,154,134,0.15);
                }

                .sidebar-close-btn {
                    background: none;
                    border: none;
                    color: var(--gradient-middle);
                    cursor: pointer;
                    padding: 0.5rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.2s ease;
                }

                .sidebar-close-btn:hover {
                    transform: scale(1.1);
                }

                .sidebar-profile {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    padding: 1rem 0.5rem;
                    margin-bottom: 2rem;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                }

                .sidebar-profile.sidebar-profile-btn {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    text-align: left;
                    border-radius: 12px;
                    transition: background 0.2s ease;
                }

                .sidebar-profile.sidebar-profile-btn:hover {
                    background: rgba(255,154,134,0.08);
                }

                .sidebar-profile .profile-chevron {
                    opacity: 0.5;
                }

                .profile-avatar {
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                    object-fit: cover;
                    border: 2px solid var(--unified-nav-color);
                    margin-right: 1rem;
                }

                .profile-info h6 {
                    margin: 0;
                    font-weight: 600;
                    font-size: 1.1rem;
                    color: #2D3436;
                }

                .profile-info small {
                    color: #FF9A86;
                    font-weight: 500;
                }

                .sidebar-nav {
                    flex: 1;
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }

                .sidebar-nav-link {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 1rem 1.25rem;
                    margin-bottom: 0.5rem;
                    border-radius: 12px;
                    text-decoration: none;
                    color: #5a6c7d;
                    font-weight: 500;
                    transition: all 0.3s ease;
                    font-size: 1.1rem;
                }

                .sidebar-nav-link:hover,
                .sidebar-nav-link.active {
                    background: var(--unified-nav-gradient);
                    color: white;
                    transform: translateX(5px);
                }

                .sidebar-nav-link .nav-icon,
                .logout-btn .nav-icon {
                    width: 20px;
                    height: 20px;
                    margin-right: 0.75rem;
                    flex-shrink: 0;
                }

                .sidebar-footer {
                    padding: 1rem 0;
                    border-top: 1px solid rgba(0, 0, 0, 0.1);
                }

                .logout-btn {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 0.75rem 1.25rem;
                    border-radius: 12px;
                    text-decoration: none;
                    color: #5a6c7d;
                    font-weight: 500;
                    transition: all 0.3s ease;
                }

                .logout-btn:hover {
                    background: rgba(255,154,134,0.10);
                    color: #FF9A86;
                    transform: translateX(5px);
                }

                /* Mobile Overlay */
                .mobile-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(3px);
                    z-index: 9998;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s ease;
                }

                .mobile-overlay.active {
                    opacity: 1;
                    visibility: visible;
                }

                /* Quick Actions Panel */
                .quick-actions-panel {
                    position: fixed;
                    top: 0;
                    right: 0;
                    width: 280px;
                    height: 100vh;
                    background: white;
                    z-index: 9999;
                    padding: 2rem 1.5rem;
                    overflow-y: auto;
                    transform: translateX(100%);
                    transition: transform 0.3s ease;
                    box-shadow: -5px 0 20px rgba(0, 0, 0, 0.1);
                }

                .quick-actions-panel.active {
                    transform: translateX(0);
                }

                .actions-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1.5rem;
                    padding-bottom: 1rem;
                    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
                }

                .actions-header h5 {
                    margin: 0;
                    font-weight: 600;
                    color: var(--unified-nav-color);
                }

                .actions-content {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .action-item {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    padding: 1rem 1.25rem;
                    border: none;
                    border-radius: 12px;
                    background: #f8fafc;
                    color: #5a6c7d;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    text-align: left;
                    width: 100%;
                }

                .action-item:hover {
                    background: var(--unified-nav-gradient);
                    color: white;
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(255,154,134,0.25);
                }

                .action-item i {
                    font-size: 1.2rem;
                    width: 20px;
                    text-align: center;
                }

                .emergency-btn {
                    background: rgba(255, 69, 58, 0.1);
                    color: #FF453A;
                }

                .emergency-btn:hover {
                    background: linear-gradient(135deg, #FF453A 0%, #FF9A86 100%);
                    color: white;
                }

                .share-btn i { color: #007AFF; }
                .call-btn i { color: #34C759; }
                .route-btn i { color: #FFA500; }

                /* Responsive Design */
                @media (min-width: 992px) {
                    .fixed-nav-btn {
                        display: none !important;
                    }

                    .hershield-sidebar {
                        transform: translateX(0) !important;
                        z-index: auto !important;
                    }

                    body {
                        margin-left: var(--sidebar-width) !important;
                    }
                }

                @media (max-width: 991px) {
                    /* The fixed hamburger/actions buttons (top:20px, 50px tall) sit on
                       top of the page and don't scroll — without this, page content
                       scrolls up underneath them and gets visually obscured (e.g. a
                       post's username/tag hidden behind the button circles).
                       !important because each page sets its own inline padding on
                       .main-content (e.g. style="padding:1.5rem"), which otherwise
                       wins over this rule regardless of media query specificity. */
                    .main-content {
                        padding-top: 90px !important;
                    }

                    /* Ensure sidebar is hidden by default on mobile */
                    .hershield-sidebar {
                        transform: translateX(-100%) !important;
                    }
                    
                    /* Show sidebar when active */
                    .hershield-sidebar.active {
                        transform: translateX(0) !important;
                    }
                    
                    .sidebar-nav-link,
                    .logout-btn {
                        padding: 0.75rem 1rem;
                        font-size: 1rem;
                    }

                    .profile-info h6 {
                        font-size: 1rem;
                    }

                    .quick-actions-panel {
                        width: 85%;
                        max-width: 300px;
                    }
                }

                @media (max-width: 576px) {
                    .sidebar-header-mobile {
                        display: flex;
                    }

                    .sidebar-nav-link .nav-icon,
                    .logout-btn .nav-icon {
                        width: 22px;
                        height: 22px;
                    }

                    .sidebar-nav-link,
                    .logout-btn {
                        padding: 0.85rem 1rem;
                        font-size: 0.95rem;
                    }

                    .quick-actions-panel {
                        width: 90%;
                        max-width: 280px;
                        padding: 1.5rem 1rem;
                    }

                    .action-item span {
                        font-size: 0.9rem;
                    }
                }

                /* Loading Animation */
                @keyframes slideIn {
                    from {
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }

                .hershield-sidebar.active {
                    animation: slideIn 0.3s ease;
                }

                /* Prevent body scroll when mobile menu is open */
                body.mobile-menu-open {
                    overflow: hidden;
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styleHtml);

        // SOS-specific extra styles
        const sosStyles = `
            <style id="sos-styles">
            .sos-nav-btn {
                background: linear-gradient(135deg, rgba(255,69,58,0.15), rgba(192,57,43,0.12)) !important;
                color: #c0392b !important;
                border: 1.5px solid rgba(255,69,58,0.3);
                position: relative;
            }
            .sos-nav-btn:hover, .sos-nav-btn.sos-active {
                background: linear-gradient(135deg, #FF453A, #c0392b) !important;
                color: white !important;
                border-color: transparent;
            }
            .sos-nav-btn svg { color: #c0392b; }
            .sos-nav-btn:hover svg, .sos-nav-btn.sos-active svg { color: white; }
            @keyframes sosPulse {
                0%,100% { box-shadow: 0 0 0 0 rgba(255,69,58,0.5); }
                50% { box-shadow: 0 0 0 10px rgba(255,69,58,0); }
            }
            .sos-nav-btn.sos-active {
                animation: sosPulse 1.5s infinite;
            }
            .sos-active-badge {
                background: #FF453A;
                color: white;
                font-size: 0.55rem;
                font-weight: 700;
                letter-spacing: 0.05em;
                padding: 2px 6px;
                border-radius: 20px;
                margin-left: auto;
                animation: sosPulse 1.5s infinite;
            }
            .sos-trigger-btn {
                background: linear-gradient(135deg, #FF453A, #c0392b);
                color: white;
                border: none;
                border-radius: 14px;
                font-size: 1rem;
                transition: all 0.3s ease;
            }
            .sos-trigger-btn:hover {
                transform: scale(1.02);
                box-shadow: 0 6px 20px rgba(255,69,58,0.4);
                color: white;
            }
            .sos-trigger-btn:disabled { opacity: 0.6; pointer-events: none; }
            .sos-pulse-circle {
                width: 90px;
                height: 90px;
                border-radius: 50%;
                background: linear-gradient(135deg, #FF453A, #c0392b);
                display: flex;
                align-items: center;
                justify-content: center;
                animation: sosPulse 1.2s infinite;
            }
            .sos-pin-input:focus { border-color: #FF453A; box-shadow: 0 0 0 3px rgba(255,69,58,0.2); }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', sosStyles);
    }

    initUnifiedNav() {
        console.log('🔧 initUnifiedNav called');

        const sidebarToggle = document.getElementById('fixedSidebarToggle');
        const actionsToggle = document.getElementById('fixedActionsToggle');
        const sidebar = document.getElementById('sidebar');
        const mobileOverlay = document.getElementById('mobileOverlay');
        const quickActionsPanel = document.getElementById('quickActionsPanel');
        const closeQuickActionsBtn = document.getElementById('closeQuickActions');

        console.log('Elements found:', {
            sidebarToggle: !!sidebarToggle,
            actionsToggle: !!actionsToggle,
            sidebar: !!sidebar,
            mobileOverlay: !!mobileOverlay,
            quickActionsPanel: !!quickActionsPanel
        });

        // Sidebar toggle functionality
        if (sidebarToggle && sidebar && mobileOverlay) {
            console.log('✅ Setting up sidebar toggle');

            sidebarToggle.addEventListener('click', (e) => {
                console.log('🔘 Sidebar toggle clicked!');
                e.preventDefault();
                e.stopPropagation();
                sidebar.classList.toggle('active');
                mobileOverlay.classList.toggle('active');
                document.body.classList.toggle('mobile-menu-open');

                // Toggle button visibility
                if (sidebar.classList.contains('active')) {
                    sidebarToggle.style.display = 'none';
                } else {
                    sidebarToggle.style.display = 'flex';
                }

                console.log('Sidebar active:', sidebar.classList.contains('active'));

                // Close quick actions if open
                if (quickActionsPanel) {
                    quickActionsPanel.classList.remove('active');
                }
            });
        } else {
            console.error('❌ Cannot set up sidebar toggle. Missing:', {
                sidebarToggle: !sidebarToggle,
                sidebar: !sidebar,
                mobileOverlay: !mobileOverlay
            });
        }

        // Close button functionality
        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        if (sidebarCloseBtn && sidebar && mobileOverlay) {
            sidebarCloseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sidebar.classList.remove('active');
                mobileOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');

                // Show hamburger button again
                if (sidebarToggle) {
                    sidebarToggle.style.display = 'flex';
                }
            });
        }

        // Actions panel toggle functionality
        if (actionsToggle && quickActionsPanel && mobileOverlay) {
            actionsToggle.addEventListener('click', () => {
                quickActionsPanel.classList.toggle('active');
                mobileOverlay.classList.toggle('active');
                document.body.classList.toggle('mobile-menu-open');

                // Close sidebar if open
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            });
        }

        // Close quick actions with close button
        if (closeQuickActionsBtn && quickActionsPanel && mobileOverlay) {
            closeQuickActionsBtn.addEventListener('click', () => {
                quickActionsPanel.classList.remove('active');
                mobileOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');
            });
        }

        // Close on overlay click
        if (mobileOverlay) {
            mobileOverlay.addEventListener('click', () => {
                if (sidebar) sidebar.classList.remove('active');
                if (quickActionsPanel) quickActionsPanel.classList.remove('active');
                mobileOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');

                // Show hamburger button again
                if (sidebarToggle) {
                    sidebarToggle.style.display = 'flex';
                }
            });
        }

        // Close panels when clicking navigation links
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('sidebar-nav-link') && window.innerWidth < 992) {
                // Small delay to allow navigation
                setTimeout(() => {
                    if (sidebar) sidebar.classList.remove('active');
                    if (mobileOverlay) mobileOverlay.classList.remove('active');
                    document.body.classList.remove('mobile-menu-open');
                }, 200);
            }
        });

        // Handle window resize for desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 992) {
                if (sidebar) sidebar.classList.remove('active');
                if (quickActionsPanel) quickActionsPanel.classList.remove('active');
                if (mobileOverlay) mobileOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');
            }
        });

        // ─── Emergency Contacts Logic (Firestore-backed) ───────────────────────
        const emergencyContactsBtn = document.getElementById('emergencyContactsBtn');
        const emergencyContactsModalEl = document.getElementById('emergencyContactsModal');
        const emergencyContactsForm = document.getElementById('emergencyContactsForm');
        const savedContactsList = document.getElementById('savedContactsList');
        const noContactsMsg = document.getElementById('noContactsMsg');

        /** Get the current user ID (Firebase UID = Firestore doc key). */
        const getCurrentUserId = () =>
            localStorage.getItem('hershield_backend_user_id') ||
            window.authService?.getCurrentUser?.()?.uid;

        /** Fetch contacts from Firestore API and cache in localStorage as fallback. */
        const fetchContactsFromFirestore = async () => {
            const userId = getCurrentUserId();
            if (!userId) return JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
            try {
                const r = await fetch(`/api/emergency/contacts/${encodeURIComponent(userId)}`);
                const j = await r.json();
                if (r.ok && j.success) {
                    localStorage.setItem('hershield_emergency_contacts', JSON.stringify(j.contacts));
                    return j.contacts;
                }
            } catch (e) {
                console.warn('Could not fetch contacts from Firestore, using local cache:', e.message);
            }
            return JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
        };

        /** Render the contacts list inside the modal. */
        const renderContacts = async () => {
            const contacts = await fetchContactsFromFirestore();

            if (savedContactsList) {
                Array.from(savedContactsList.children).forEach(child => {
                    if (child.id !== 'noContactsMsg') child.remove();
                });

                if (contacts.length === 0) {
                    if (noContactsMsg) noContactsMsg.style.display = 'block';
                } else {
                    if (noContactsMsg) noContactsMsg.style.display = 'none';
                    contacts.forEach((contact) => {
                        const item = document.createElement('div');
                        item.className = 'list-group-item d-flex justify-content-between align-items-center px-0';
                        item.innerHTML = `
                            <div>
                                <h6 class="mb-0 fw-bold">${contact.name}</h6>
                                <small class="text-muted">${[contact.phone, contact.email].filter(Boolean).join(' · ')}</small>
                                <small class="d-block text-muted">${contact.relationship || ''}</small>
                            </div>
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="window.removeContact('${contact._id}')">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        `;
                        savedContactsList.appendChild(item);
                    });
                }
            }
        };

        /** Remove contact via Firestore API and re-render. */
        window.removeContact = async (contactId) => {
            const userId = getCurrentUserId();
            if (userId) {
                try {
                    await fetch(`/api/emergency/contacts/${encodeURIComponent(userId)}/${encodeURIComponent(contactId)}`, {
                        method: 'DELETE',
                    });
                } catch (e) {
                    console.warn('Delete contact failed, removing locally:', e.message);
                }
            }
            // Update local cache optimistically
            const cached = JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
            localStorage.setItem('hershield_emergency_contacts', JSON.stringify(cached.filter(c => c._id !== contactId)));
            await renderContacts();
        };

        if (emergencyContactsBtn && emergencyContactsModalEl) {
            if (typeof bootstrap !== 'undefined') {
                const modal = new bootstrap.Modal(emergencyContactsModalEl);

                emergencyContactsBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    await renderContacts();
                    modal.show();

                    if (window.innerWidth < 992 && sidebar) {
                        sidebar.classList.remove('active');
                        mobileOverlay.classList.remove('active');
                        document.body.classList.remove('mobile-menu-open');
                    }
                });

                if (emergencyContactsForm) {
                    emergencyContactsForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const name = document.getElementById('contactName').value.trim();
                        const phone = document.getElementById('contactPhone').value.trim();
                        const email = document.getElementById('contactEmail').value.trim();
                        const relationship = document.getElementById('contactRelationship')?.value || 'Emergency Contact';
                        const userId = getCurrentUserId();

                        if (!phone && !email) {
                            alert('Please enter at least a phone number or email address.');
                            return;
                        }

                        if (!userId) {
                            alert('Please log in to save emergency contacts to your account.');
                            return;
                        }

                        const submitBtn = emergencyContactsForm.querySelector('[type="submit"]');
                        const originalText = submitBtn.innerHTML;
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

                        try {
                            const resp = await fetch('/api/emergency/contacts', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ userId, name, phone: phone || undefined, email: email || undefined, relationship }),
                            });
                            const result = await resp.json();
                            if (!resp.ok) {
                                throw new Error(result.error || 'Failed to save contact');
                            }
                            // Update local cache
                            localStorage.setItem('hershield_emergency_contacts', JSON.stringify(result.contacts));
                        } catch (err) {
                            console.error('Save contact error:', err);
                            alert('Could not save contact: ' + err.message);
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = originalText;
                            return;
                        }

                        emergencyContactsForm.reset();
                        const relSelect = document.getElementById('contactRelationship');
                        if (relSelect) relSelect.value = '';
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalText;
                        await renderContacts();
                    });
                }

                // Show contacts modal on first dashboard load if no contacts yet
                if (this.currentPage === 'dashboard') {
                    const userId = getCurrentUserId();
                    if (userId) {
                        setTimeout(async () => {
                            const contacts = await fetchContactsFromFirestore();
                            if (contacts.length === 0) {
                                await renderContacts();
                                modal.show();
                            }
                        }, 1800);
                    }
                }
            }
        }

        // ─── SOS Alert State Machine ──────────────────────────────────────────
        (function initSosSystem() {
            const sosNavBtn        = document.getElementById('sosNavBtn');
            const quickSosBtn      = document.getElementById('quickSosBtn');
            const sosModalEl       = document.getElementById('sosAlertModal');
            const imSafeModalEl    = document.getElementById('imSafeModal');
            const sosSidebarBadge  = document.getElementById('sosSidebarBadge');

            if (!sosModalEl || typeof bootstrap === 'undefined') return;

            const sosModal    = new bootstrap.Modal(sosModalEl);
            const imSafeModal = new bootstrap.Modal(imSafeModalEl);

            // State
            let sosSate = 'idle'; // 'idle' | 'active'
            let sosGpsPollInterval = null;
            let sosTimerInterval   = null;
            let activeSosData      = null; // { sosId, trackingCode, expiresAt, contactCount }

            const getCurrentUserId = () =>
                localStorage.getItem('hershield_backend_user_id') ||
                window.authService?.getCurrentUser?.()?.uid;

            // ── UI helpers ──
            function setSosActiveUI(data) {
                sosSate = 'active';
                activeSosData = data;
                document.getElementById('sosStep1').style.display = 'none';
                document.getElementById('sosStep2').style.display = '';
                document.getElementById('sosContactCount').textContent = data.contactCount || 0;
                if (sosNavBtn) {
                    sosNavBtn.classList.add('sos-active');
                    sosSidebarBadge && (sosSidebarBadge.style.display = '');
                }
                // Update timer display
                updateTimerDisplay(data.expiresAt);
            }

            function resetSosUI() {
                sosSate = 'idle';
                activeSosData = null;
                clearInterval(sosGpsPollInterval);
                clearInterval(sosTimerInterval);
                sosGpsPollInterval = null;
                sosTimerInterval = null;
                document.getElementById('sosStep1').style.display = '';
                document.getElementById('sosStep2').style.display = 'none';
                document.getElementById('sosPinInput').value = '';
                document.getElementById('sosPinDisplay').style.display = 'none';
                document.getElementById('sosPinDisplay').textContent = '';
                document.getElementById('sosTimerSelect').value = '';
                const fb = document.getElementById('sosFeedback');
                fb.classList.add('d-none'); fb.textContent = '';
                if (sosNavBtn) {
                    sosNavBtn.classList.remove('sos-active');
                    sosSidebarBadge && (sosSidebarBadge.style.display = 'none');
                }
                document.getElementById('sosTimerDisplay').textContent = '';
            }

            function showSosFeedback(msg, type = 'danger') {
                const fb = document.getElementById('sosFeedback');
                fb.className = `alert alert-${type} mb-3`;
                fb.textContent = msg;
                fb.classList.remove('d-none');
            }

            function updateTimerDisplay(expiresAt) {
                const el = document.getElementById('sosTimerDisplay');
                if (!expiresAt) { if (el) el.textContent = 'No auto-stop timer set.'; return; }
                clearInterval(sosTimerInterval);
                sosTimerInterval = setInterval(() => {
                    const remaining = new Date(expiresAt).getTime() - Date.now();
                    if (remaining <= 0) {
                        clearInterval(sosTimerInterval);
                        if (el) el.textContent = 'Timer expired — location sharing stopped automatically.';
                        resetSosUI();
                        sosModal.hide();
                        return;
                    }
                    const m = Math.floor(remaining / 60000);
                    const s = Math.floor((remaining % 60000) / 1000);
                    if (el) el.textContent = `Auto-stops in ${m}:${String(s).padStart(2,'0')}`;
                }, 1000);
            }

            // ── GPS location helper ──
            function getCurrentLocation() {
                return new Promise((resolve, reject) => {
                    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
                    navigator.geolocation.getCurrentPosition(
                        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                        (err) => reject(new Error(err.message || 'Location unavailable')),
                        { timeout: 10000, maximumAge: 30000 }
                    );
                });
            }

            // ── Push location to live-tracker backend ──
            async function pushLocationUpdate(userId) {
                try {
                    const loc = await getCurrentLocation();
                    await fetch('/api/live-tracker/update-location', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, lat: loc.latitude, lng: loc.longitude }),
                    });
                } catch (e) {
                    console.warn('GPS push failed:', e.message);
                }
            }

            // ── Start GPS polling loop (every 10s) ──
            function startGpsPoll(userId) {
                clearInterval(sosGpsPollInterval);
                pushLocationUpdate(userId); // immediate first push
                sosGpsPollInterval = setInterval(() => pushLocationUpdate(userId), 10000);
            }

            // ── Open SOS modal ──
            function openSosModal(e) {
                if (e) e.preventDefault();
                // Close sidebar/quick-actions if open
                if (sidebar) sidebar.classList.remove('active');
                if (quickActionsPanel) quickActionsPanel.classList.remove('active');
                if (mobileOverlay) mobileOverlay.classList.remove('active');
                document.body.classList.remove('mobile-menu-open');

                if (sosSate === 'active') {
                    // Already active: show step 2 directly
                    document.getElementById('sosStep1').style.display = 'none';
                    document.getElementById('sosStep2').style.display = '';
                } else {
                    resetSosUI();
                }
                sosModal.show();
            }

            // ── Wire buttons ──
            if (sosNavBtn)   sosNavBtn.addEventListener('click', openSosModal);
            if (quickSosBtn) quickSosBtn.addEventListener('click', openSosModal);

            // ── Close button (only allowed when idle) ──
            const sosCloseBtn = document.getElementById('sosModalCloseBtn');
            if (sosCloseBtn) {
                sosCloseBtn.addEventListener('click', () => {
                    if (sosSate === 'active') {
                        // Don't allow close while SOS active — they must use I'm Safe
                        return;
                    }
                    sosModal.hide();
                });
            }

            // ── Generate PIN ──
            const generatePinBtn = document.getElementById('sosGeneratePinBtn');
            if (generatePinBtn) {
                generatePinBtn.addEventListener('click', () => {
                    const pin = String(Math.floor(1000 + Math.random() * 9000));
                    document.getElementById('sosPinInput').value = pin;
                    const display = document.getElementById('sosPinDisplay');
                    display.textContent = `Your PIN: ${pin} — Remember this!`;
                    display.style.display = '';
                });
            }

            // ── Trigger SOS ──
            const sosTriggerBtn = document.getElementById('sosTriggerBtn');
            if (sosTriggerBtn) {
                sosTriggerBtn.addEventListener('click', async () => {
                    const pin = document.getElementById('sosPinInput').value.trim();
                    if (!/^\d{4}$/.test(pin)) {
                        showSosFeedback('Please enter a 4-digit PIN (or tap "Generate" for a random one).');
                        return;
                    }
                    const userId = getCurrentUserId();
                    if (!userId) {
                        showSosFeedback('Please log in first.');
                        return;
                    }

                    sosTriggerBtn.disabled = true;
                    sosTriggerBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Getting your location...';

                    try {
                        let location;
                        try {
                            location = await getCurrentLocation();
                        } catch (geoErr) {
                            // Fallback dummy location — still send alert
                            location = { latitude: 0, longitude: 0 };
                            showSosFeedback('Could not get GPS location — alert sent with last known position.', 'warning');
                        }

                        const timerVal = document.getElementById('sosTimerSelect').value;
                        const body = {
                            userId,
                            location,
                            pin,
                            ...(timerVal ? { timerMinutes: parseInt(timerVal, 10) } : {}),
                        };

                        sosTriggerBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Sending alerts...';
                        const resp = await fetch('/api/emergency/sos/start', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const result = await resp.json();
                        if (!resp.ok) throw new Error(result.error || result.errors?.[0]?.msg || 'Failed to start SOS');

                        // Store SOS data
                        localStorage.setItem('hershield_sos_active', JSON.stringify({
                            sosId: result.sosId,
                            trackingCode: result.trackingCode,
                            expiresAt: result.expiresAt,
                            contactCount: result.contactCount,
                            userId,
                        }));

                        setSosActiveUI({ sosId: result.sosId, trackingCode: result.trackingCode, expiresAt: result.expiresAt, contactCount: result.contactCount });
                        startGpsPoll(userId);

                        sosTriggerBtn.disabled = false;
                        sosTriggerBtn.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i><strong>SEND EMERGENCY ALERT</strong>';
                    } catch (err) {
                        showSosFeedback(err.message);
                        sosTriggerBtn.disabled = false;
                        sosTriggerBtn.innerHTML = '<i class="fas fa-exclamation-triangle me-2"></i><strong>SEND EMERGENCY ALERT</strong>';
                    }
                });
            }

            // ── I'm Safe ──
            const imSafeBtn = document.getElementById('imSafeBtn');
            if (imSafeBtn) {
                imSafeBtn.addEventListener('click', () => {
                    document.getElementById('imSafePinInput').value = '';
                    document.getElementById('imSafePinError').textContent = '';
                    imSafeModal.show();
                });
            }

            const imSafeConfirmBtn = document.getElementById('imSafeConfirmBtn');
            if (imSafeConfirmBtn) {
                imSafeConfirmBtn.addEventListener('click', async () => {
                    const pin = document.getElementById('imSafePinInput').value.trim();
                    const errorEl = document.getElementById('imSafePinError');
                    if (!/^\d{4}$/.test(pin)) {
                        errorEl.textContent = 'Please enter your 4-digit PIN.';
                        return;
                    }
                    const userId = getCurrentUserId();
                    if (!userId) { errorEl.textContent = 'Session error. Please reload.'; return; }

                    imSafeConfirmBtn.disabled = true;
                    imSafeConfirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Verifying...';

                    try {
                        const resp = await fetch('/api/emergency/sos/safe', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId, pin }),
                        });
                        const result = await resp.json();
                        if (resp.status === 401) {
                            errorEl.textContent = 'Incorrect PIN. Location sharing continues.';
                            imSafeConfirmBtn.disabled = false;
                            imSafeConfirmBtn.innerHTML = '<i class="fas fa-check-circle me-2"></i>Confirm Safe';
                            return;
                        }
                        if (!resp.ok) throw new Error(result.error || 'Failed to mark safe');

                        // Reset everything
                        localStorage.removeItem('hershield_sos_active');
                        resetSosUI();
                        imSafeModal.hide();
                        sosModal.hide();

                        // Show success toast
                        const toast = document.createElement('div');
                        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;';
                        toast.innerHTML = '<div class="alert alert-success shadow-lg px-4 py-3 mb-0"><i class="fas fa-check-circle me-2"></i>You\'re marked safe! Location sharing stopped.</div>';
                        document.body.appendChild(toast);
                        setTimeout(() => toast.remove(), 4000);
                    } catch (err) {
                        errorEl.textContent = err.message;
                        imSafeConfirmBtn.disabled = false;
                        imSafeConfirmBtn.innerHTML = '<i class="fas fa-check-circle me-2"></i>Confirm Safe';
                    }
                });
            }

            // ── On page load: restore active SOS if any ──
            (async () => {
                const userId = getCurrentUserId();
                if (!userId) return;
                try {
                    const resp = await fetch(`/api/emergency/sos/active/${encodeURIComponent(userId)}`);
                    const data = await resp.json();
                    if (data.active) {
                        setSosActiveUI({ sosId: data.sosId, trackingCode: data.trackingCode, expiresAt: data.expiresAt, contactCount: data.contactCount });
                        startGpsPoll(userId);
                    } else {
                        // Clear any stale localStorage
                        localStorage.removeItem('hershield_sos_active');
                        resetSosUI();
                    }
                } catch (e) {
                    console.warn('SOS active check failed:', e.message);
                    // Try localStorage fallback
                    const cached = localStorage.getItem('hershield_sos_active');
                    if (cached) {
                        const d = JSON.parse(cached);
                        if (d.expiresAt && new Date(d.expiresAt) > new Date()) {
                            setSosActiveUI(d);
                            if (d.userId === userId) startGpsPoll(userId);
                        } else {
                            localStorage.removeItem('hershield_sos_active');
                        }
                    }
                }
            })();
        })();

        const PROFILE_STORAGE_KEY = 'hershield_user_profile';

        // We no longer cap at 750KB because photos go to Firebase Storage, not localStorage
        const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB hard cap for upload

        const loadExtendedProfile = () => {
            try {
                return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}');
            } catch {
                return {};
            }
        };

        const saveExtendedProfile = (obj) => {
            localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(obj));
        };

        window.refreshHershieldSidebarProfile = () => {
            const img = document.querySelector('.hershield-sidebar .profile-avatar');
            const nameEl = document.querySelector('.hershield-sidebar .profile-name');
            const localAvatar = localStorage.getItem('hershield_user_avatar');
            const nm =
                localStorage.getItem('hershield_user_name') ||
                localStorage.getItem('hershield_user_email')?.split('@')[0] ||
                'Her Shield User';
            if (img) {
                if (localAvatar) img.src = localAvatar;
                else if (window.authService?.getCurrentUser?.()?.photoURL)
                    img.src = window.authService.getCurrentUser().photoURL;
                else
                    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nm)}&background=BDA6CE&color=fff`;
            }
            if (nameEl) nameEl.textContent = nm;
        };

        const profileBtn = document.getElementById('sidebarProfileBtn');
        const profileModalEl = document.getElementById('profileSettingsModal');
        const profileForm = document.getElementById('profileSettingsForm');
        const profilePhotoFile = document.getElementById('profilePhotoFile');
        const profilePhotoPreview = document.getElementById('profilePhotoPreview');
        let pendingAvatarDataUrl = null;

        const fillProfileForm = async () => {
            const ext = loadExtendedProfile();
            const email = localStorage.getItem('hershield_user_email') || '';
            const name =
                localStorage.getItem('hershield_user_name') ||
                ext.displayName ||
                email.split('@')[0] ||
                '';
            document.getElementById('profileDisplayName').value = name;
            document.getElementById('profileEmailField').value = email;
            document.getElementById('profileAge').value = ext.age || '';
            document.getElementById('profileHomeAddress').value = ext.homeAddress || '';
            document.getElementById('profilePersonalPhone').value = ext.personalPhone || '';
            document.getElementById('profileBloodGroup').value = ext.bloodGroup || '';
            document.getElementById('profileAllergies').value = ext.allergies || '';
            document.getElementById('profileMedications').value = ext.medications || '';
            document.getElementById('profilePhotoUrl').value = ext.photoUrl || '';
            pendingAvatarDataUrl = null;
            profilePhotoFile.value = '';
            const av =
                localStorage.getItem('hershield_user_avatar') ||
                window.authService?.getCurrentUser?.()?.photoURL ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=BDA6CE&color=fff`;
            profilePhotoPreview.src = av;
            const fb = document.getElementById('profileSettingsFeedback');
            if (fb) {
                fb.classList.add('d-none');
                fb.textContent = '';
            }

            // ─ Fetch from Firestore API so extended fields (blood group, address, etc.) ─
            // survive logout and reappear the next time the profile modal is opened.
            try {
                let userId = localStorage.getItem('hershield_backend_user_id');
                if (!userId && email) {
                    const r = await fetch(`/api/users/email/${encodeURIComponent(email)}`);
                    const j = await r.json();
                    if (j.success && j.exists && j.user && j.user._id) {
                        userId = j.user._id;
                        localStorage.setItem('hershield_backend_user_id', userId);
                    }
                }
                if (userId) {
                    const resp = await fetch(`/api/users/profile/${encodeURIComponent(userId)}`);
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data.success && data.user) {
                            const u = data.user;
                            const merged = { ...ext,
                                age: u.age || ext.age || '',
                                homeAddress: u.homeAddress || ext.homeAddress || '',
                                bloodGroup: u.bloodGroup || ext.bloodGroup || '',
                                allergies: u.allergies || ext.allergies || '',
                                medications: u.medications || ext.medications || '',
                                personalPhone: u.phone || ext.personalPhone || '',
                            };
                            saveExtendedProfile(merged);
                            if (u.age)         document.getElementById('profileAge').value = u.age;
                            if (u.homeAddress)  document.getElementById('profileHomeAddress').value = u.homeAddress;
                            if (u.phone)        document.getElementById('profilePersonalPhone').value = u.phone;
                            if (u.bloodGroup)   document.getElementById('profileBloodGroup').value = u.bloodGroup;
                            if (u.allergies)    document.getElementById('profileAllergies').value = u.allergies;
                            if (u.medications)  document.getElementById('profileMedications').value = u.medications;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Profile] API fetch skipped:', e.message);
            }
        };

        /**
         * Upload a File object to Firebase Storage and return the public download URL.
         * Path: avatars/{uid}/{timestamp}-{filename}
         */
        async function uploadAvatarToStorage(file) {
            const uid = window.authService?.getCurrentUser?.()?.uid;
            if (!uid) throw new Error('Not signed in');
            const { storage } = await import('./firebase-config.js');
            const { ref, uploadBytes, getDownloadURL } =
                await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
            const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
            const path = `avatars/${uid}/${Date.now()}.${ext}`;
            const storageRef = ref(storage, path);
            const snapshot   = await uploadBytes(storageRef, file);
            const url        = await getDownloadURL(snapshot.ref);
            return url;
        }

        if (profilePhotoFile && profilePhotoPreview) {
            profilePhotoFile.addEventListener('change', () => {
                const f = profilePhotoFile.files && profilePhotoFile.files[0];
                if (!f) return;
                if (f.size > MAX_AVATAR_BYTES) {
                    alert('Image is too large. Please choose a file under 5 MB.');
                    profilePhotoFile.value = '';
                    return;
                }
                // Show local preview immediately while we wait for the upload
                const reader = new FileReader();
                reader.onload = () => {
                    pendingAvatarDataUrl = reader.result; // used as temp preview only
                    profilePhotoPreview.src = pendingAvatarDataUrl;
                    document.getElementById('profilePhotoUrl').value = '';
                };
                reader.readAsDataURL(f);
            });
        }

        const syncProfileToBackend = async (payload) => {
            // Use Firebase UID as the user document key — no extra lookup needed
            const userId =
                localStorage.getItem('hershield_backend_user_id') ||
                window.authService?.getCurrentUser?.()?.uid;
            if (!userId) {
                console.warn('Profile sync skipped: no userId available');
                return;
            }
            try {
                const body = {
                    name: payload.displayName,
                    phone: payload.personalPhone || undefined,
                    profilePicture: payload.profilePictureHttp || undefined,
                    age: payload.age || undefined,
                    homeAddress: payload.homeAddress || undefined,
                    bloodGroup: payload.bloodGroup || undefined,
                    allergies: payload.allergies || undefined,
                    medications: payload.medications || undefined,
                };
                const resp = await fetch(`/api/users/profile/${encodeURIComponent(userId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (resp.ok) {
                    console.log('✅ Profile synced to Firestore');
                } else {
                    console.warn('⚠️ Profile sync returned', resp.status, await resp.text());
                }
            } catch (e) {
                console.warn('Profile server sync skipped:', e);
            }
        };

        if (profileBtn && profileModalEl && profileForm && typeof bootstrap !== 'undefined') {
            const profileModal = new bootstrap.Modal(profileModalEl);

            // Fix Bootstrap aria-hidden warning: blur focused elements before modal hides
            profileModalEl.addEventListener('hide.bs.modal', () => {
                if (document.activeElement && profileModalEl.contains(document.activeElement)) {
                    document.activeElement.blur();
                }
            });
            profileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                fillProfileForm();
                profileModal.show();
                if (window.innerWidth < 992 && sidebar) {
                    sidebar.classList.remove('active');
                    mobileOverlay.classList.remove('active');
                    document.body.classList.remove('mobile-menu-open');
                }
            });

            profileForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fb = document.getElementById('profileSettingsFeedback');
                const displayName = document.getElementById('profileDisplayName').value.trim();
                if (!displayName) {
                    fb.textContent = 'Please enter a display name.';
                    fb.className = 'alert alert-warning mt-3 mb-0';
                    fb.classList.remove('d-none');
                    return;
                }

                // Show saving state
                fb.textContent = 'Saving…';
                fb.className = 'alert alert-info mt-3 mb-0';
                fb.classList.remove('d-none');

                const photoUrlInput = document.getElementById('profilePhotoUrl').value.trim();
                let resolvedAvatarUrl = null;  // will be a permanent https:// URL

                // Priority 1: file upload → upload to Firebase Storage
                const selectedFile = profilePhotoFile && profilePhotoFile.files && profilePhotoFile.files[0];
                if (selectedFile) {
                    try {
                        fb.textContent = 'Uploading photo to cloud…';
                        resolvedAvatarUrl = await uploadAvatarToStorage(selectedFile);
                        console.log('✅ Avatar uploaded to Firebase Storage:', resolvedAvatarUrl);
                    } catch (uploadErr) {
                        console.warn('Firebase Storage upload failed, falling back to base64:', uploadErr.message);
                        // Fallback: keep base64 in localStorage for this session
                        resolvedAvatarUrl = pendingAvatarDataUrl;
                    }
                }
                // Priority 2: manually entered HTTP URL
                else if (photoUrlInput && /^https?:\/\//i.test(photoUrlInput)) {
                    resolvedAvatarUrl = photoUrlInput;
                }
                // Priority 3: keep existing avatar URL
                else if (localStorage.getItem('hershield_user_avatar')) {
                    resolvedAvatarUrl = localStorage.getItem('hershield_user_avatar');
                }
                else if (window.authService?.getCurrentUser?.()?.photoURL) {
                    resolvedAvatarUrl = window.authService.getCurrentUser().photoURL;
                }

                // Save to localStorage
                if (resolvedAvatarUrl) localStorage.setItem('hershield_user_avatar', resolvedAvatarUrl);
                else localStorage.removeItem('hershield_user_avatar');

                localStorage.setItem('hershield_user_name', displayName);

                const ext = {
                    displayName,
                    age: document.getElementById('profileAge').value.trim(),
                    homeAddress: document.getElementById('profileHomeAddress').value.trim(),
                    personalPhone: document.getElementById('profilePersonalPhone').value.trim(),
                    bloodGroup: document.getElementById('profileBloodGroup').value,
                    allergies: document.getElementById('profileAllergies').value.trim(),
                    medications: document.getElementById('profileMedications').value.trim(),
                    photoUrl: resolvedAvatarUrl && /^https?:\/\//i.test(resolvedAvatarUrl) ? resolvedAvatarUrl : '',
                };
                saveExtendedProfile(ext);

                window.refreshHershieldSidebarProfile();
                window.dispatchEvent(new CustomEvent('hershield-profile-updated', { detail: { displayName } }));

                // Update Firebase Auth profile (displayName + photoURL)
                if (window.authService && typeof window.authService.updateFirebaseProfile === 'function') {
                    await window.authService.updateFirebaseProfile({
                        displayName,
                        photoURL: resolvedAvatarUrl && /^https?:\/\//i.test(resolvedAvatarUrl) ? resolvedAvatarUrl : null,
                    });
                }

                // Sync all fields to Firestore (including the resolved photo URL)
                await syncProfileToBackend({
                    displayName,
                    personalPhone: ext.personalPhone,
                    age: ext.age,
                    homeAddress: ext.homeAddress,
                    bloodGroup: ext.bloodGroup,
                    allergies: ext.allergies,
                    medications: ext.medications,
                    profilePictureHttp:
                        resolvedAvatarUrl && /^https?:\/\//i.test(resolvedAvatarUrl)
                            ? resolvedAvatarUrl
                            : undefined,
                });

                fb.textContent = 'Profile saved ✅';
                fb.className = 'alert alert-success mt-3 mb-0';
                fb.classList.remove('d-none');
                setTimeout(() => profileModal.hide(), 800);
            });
        }
    }

    setupMobileMenu() {
        console.log('Setting up mobile menu...');

        // Use event delegation on document to ensure clicks are captured
        document.addEventListener('click', (e) => {
            // Hamburger button click
            if (e.target.closest('#fixedSidebarToggle')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Hamburger clicked');
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('mobileOverlay');
                if (sidebar && overlay) {
                    sidebar.classList.toggle('active');
                    overlay.classList.toggle('active');
                    console.log('Sidebar toggled, active:', sidebar.classList.contains('active'));
                } else {
                    console.error('Sidebar or overlay not found');
                }
                return;
            }

            // Close button click
            if (e.target.closest('#sidebarCloseBtn')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Close button clicked');
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('mobileOverlay');
                if (sidebar && overlay) {
                    sidebar.classList.remove('active');
                    overlay.classList.remove('active');
                }
                return;
            }

            // Overlay click
            if (e.target.closest('#mobileOverlay')) {
                console.log('Overlay clicked');
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('mobileOverlay');
                if (sidebar && overlay) {
                    sidebar.classList.remove('active');
                    overlay.classList.remove('active');
                }
                return;
            }
        });

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('mobileOverlay');
                if (sidebar && overlay) {
                    sidebar.classList.remove('active');
                    overlay.classList.remove('active');
                }
                this.closeMobileMenu();
                this.closeUserDropdown();
            }
        });

        console.log('Mobile menu setup complete');
    }

    toggleMobileMenu() {
        const menu = document.getElementById('mobileMenu');
        if (menu) {
            menu.classList.toggle('open');
            this.mobileMenuOpen = menu.classList.contains('open');
        }
    }

    closeMobileMenu() {
        const menu = document.getElementById('mobileMenu');
        if (menu) {
            menu.classList.remove('open');
            this.mobileMenuOpen = false;
        }
    }

    toggleUserDropdown() {
        const menu = document.querySelector('.user-menu');
        if (menu) {
            menu.classList.toggle('open');
        }
    }

    closeUserDropdown() {
        const menu = document.querySelector('.user-menu');
        if (menu) {
            menu.classList.remove('open');
        }
    }

    updateNavState() {
        // Update navigation active states on page changes
        // This can be enhanced to handle SPA navigation
    }
}

// Global navigation manager instance
let navManager;

// Initialize navigation when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    navManager = new NavigationManager();
});

// Export for global access
window.navManager = navManager;
window.NavigationManager = NavigationManager;
