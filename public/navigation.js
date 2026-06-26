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
                        <h5 style="margin: 0; color: var(--gradient-middle);">Menu</h5>
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
                        <a href="community.html" class="sidebar-nav-link ${this.currentPage === 'community' ? 'active' : ''}">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                            <span>Community</span>
                        </a>
                        <a href="#" class="sidebar-nav-link" id="emergencyContactsBtn">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                            <span>Emergency Contacts</span>
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
                        <button class="action-item emergency-btn">
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
                                    <label class="form-label fw-bold">Contact Name</label>
                                    <input type="text" class="form-control" id="contactName" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Phone Number</label>
                                    <input type="tel" class="form-control" id="contactPhone" required>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label fw-bold">Email Address</label>
                                    <input type="email" class="form-control" id="contactEmail" required>
                                    <div class="form-text">Emergency alerts will be sent to this email.</div>
                                </div>
                                <div class="d-grid gap-2">
                                    <button type="submit" class="btn btn-primary" style="background: var(--gradient-middle); border: none;">Save Contact</button>
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
            --unified-nav-color: #BDA6CE;
            --unified-nav-gradient: linear-gradient(135deg, #BDA6CE 0%, #9B8EC7 100%);
            --sidebar-width: 280px;
            --sidebar-bg: rgba(255, 255, 255, 0.95);
            --sidebar-border: rgba(0, 0, 0, 0.1);
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
                    box-shadow: 0 4px 15px rgba(155, 142, 199, 0.4);
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
                    box-shadow: 0 6px 20px rgba(155, 142, 199, 0.5);
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
                    border-bottom: 2px solid rgba(0, 0, 0, 0.1);
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
                    background: rgba(155, 142, 199, 0.1);
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
                    color: var(--unified-nav-color);
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
                    background: rgba(155, 142, 199, 0.1);
                    color: #9B8EC7;
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
                    box-shadow: 0 5px 15px rgba(155, 142, 199, 0.2);
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
                    background: linear-gradient(135deg, #FF453A 0%, #9B8EC7 100%);
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

        // Emergency Contacts Logic
        const emergencyContactsBtn = document.getElementById('emergencyContactsBtn');
        const emergencyContactsModalEl = document.getElementById('emergencyContactsModal');
        const emergencyContactsForm = document.getElementById('emergencyContactsForm');
        const savedContactsList = document.getElementById('savedContactsList');
        const noContactsMsg = document.getElementById('noContactsMsg');

        // Helper to render contacts
        const renderContacts = () => {
            const contacts = JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');

            // Clear list except message
            if (savedContactsList) {
                Array.from(savedContactsList.children).forEach(child => {
                    if (child.id !== 'noContactsMsg') child.remove();
                });

                if (contacts.length === 0) {
                    if (noContactsMsg) noContactsMsg.style.display = 'block';
                } else {
                    if (noContactsMsg) noContactsMsg.style.display = 'none';
                    contacts.forEach((contact, index) => {
                        const item = document.createElement('div');
                        item.className = 'list-group-item d-flex justify-content-between align-items-center px-0';
                        item.innerHTML = `
                            <div>
                                <h6 class="mb-0 fw-bold">${contact.name}</h6>
                                <small class="text-muted">${contact.email}</small>
                            </div>
                            <button class="btn btn-sm btn-outline-danger border-0" onclick="window.removeContact(${index})">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        `;
                        savedContactsList.appendChild(item);
                    });
                }
            }
        };

        // Expose remove function globally
        window.removeContact = (index) => {
            const contacts = JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
            contacts.splice(index, 1);
            localStorage.setItem('hershield_emergency_contacts', JSON.stringify(contacts));
            renderContacts();
        };

        if (emergencyContactsBtn && emergencyContactsModalEl) {
            // Check if bootstrap is available
            if (typeof bootstrap !== 'undefined') {
                const modal = new bootstrap.Modal(emergencyContactsModalEl);

                emergencyContactsBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    renderContacts();
                    modal.show();

                    // Close sidebar on mobile
                    if (window.innerWidth < 992 && sidebar) {
                        sidebar.classList.remove('active');
                        mobileOverlay.classList.remove('active');
                        document.body.classList.remove('mobile-menu-open');
                    }
                });

                // Handle Form Submit
                if (emergencyContactsForm) {
                    emergencyContactsForm.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const name = document.getElementById('contactName').value;
                        const phone = document.getElementById('contactPhone').value;
                        const email = document.getElementById('contactEmail').value;

                        const contacts = JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
                        contacts.push({ name, phone, email });
                        localStorage.setItem('hershield_emergency_contacts', JSON.stringify(contacts));

                        // Reset form
                        emergencyContactsForm.reset();
                        renderContacts();
                    });
                }

                // Check if contacts exist on load (Simulate "Login" check)
                // Only check on dashboard to avoid annoyance on every page navigation
                if (this.currentPage === 'dashboard') {
                    const contacts = JSON.parse(localStorage.getItem('hershield_emergency_contacts') || '[]');
                    if (contacts.length === 0) {
                        // Small delay to allow page to settle
                        setTimeout(() => {
                            renderContacts();
                            modal.show();
                        }, 1500);
                    }
                }
            }
        }

        const PROFILE_STORAGE_KEY = 'hershield_user_profile';
        const MAX_AVATAR_BYTES = 750000;

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

            // — Also fetch from Firestore API so extended fields survive logout —
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
                            // Merge API data into localStorage cache
                            const merged = { ...ext,
                                age: u.age || ext.age || '',
                                homeAddress: u.homeAddress || ext.homeAddress || '',
                                bloodGroup: u.bloodGroup || ext.bloodGroup || '',
                                allergies: u.allergies || ext.allergies || '',
                                medications: u.medications || ext.medications || '',
                                personalPhone: u.phone || ext.personalPhone || '',
                            };
                            saveExtendedProfile(merged);
                            // Update form fields with authoritative Firestore data
                            if (u.age) document.getElementById('profileAge').value = u.age;
                            if (u.homeAddress) document.getElementById('profileHomeAddress').value = u.homeAddress;
                            if (u.phone) document.getElementById('profilePersonalPhone').value = u.phone;
                            if (u.bloodGroup) document.getElementById('profileBloodGroup').value = u.bloodGroup;
                            if (u.allergies) document.getElementById('profileAllergies').value = u.allergies;
                            if (u.medications) document.getElementById('profileMedications').value = u.medications;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Profile] API fetch skipped:', e.message);
            }
        };

        if (profilePhotoFile && profilePhotoPreview) {
            profilePhotoFile.addEventListener('change', () => {
                const f = profilePhotoFile.files && profilePhotoFile.files[0];
                if (!f) return;
                if (f.size > MAX_AVATAR_BYTES) {
                    alert('Image is too large. Please choose a smaller file (under ~700KB).');
                    profilePhotoFile.value = '';
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    pendingAvatarDataUrl = reader.result;
                    profilePhotoPreview.src = pendingAvatarDataUrl;
                    document.getElementById('profilePhotoUrl').value = '';
                };
                reader.readAsDataURL(f);
            });
        }

        const syncProfileToBackend = async (payload) => {
            const email = localStorage.getItem('hershield_user_email');
            if (!email) return;
            let userId = localStorage.getItem('hershield_backend_user_id');
            try {
                if (!userId) {
                    const r = await fetch(`/api/users/email/${encodeURIComponent(email)}`);
                    const j = await r.json();
                    if (j.success && j.exists && j.user && j.user._id) {
                        userId = j.user._id;
                        localStorage.setItem('hershield_backend_user_id', userId);
                    }
                }
                if (!userId) return;
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
                await fetch(`/api/users/profile/${encodeURIComponent(userId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch (e) {
                console.warn('Profile server sync skipped:', e);
            }
        };

        if (profileBtn && profileModalEl && profileForm && typeof bootstrap !== 'undefined') {
            const profileModal = new bootstrap.Modal(profileModalEl);

            // Fix Bootstrap aria-hidden warning: blur any focused element inside the modal
            // before the modal hides so assistive technology doesn't see a focused-but-hidden element
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
                const photoUrlInput = document.getElementById('profilePhotoUrl').value.trim();
                let avatarToStore = null;
                if (pendingAvatarDataUrl) {
                    avatarToStore = pendingAvatarDataUrl;
                } else if (photoUrlInput && /^https?:\/\//i.test(photoUrlInput)) {
                    avatarToStore = photoUrlInput;
                } else if (localStorage.getItem('hershield_user_avatar')) {
                    avatarToStore = localStorage.getItem('hershield_user_avatar');
                } else if (window.authService?.getCurrentUser?.()?.photoURL) {
                    avatarToStore = window.authService.getCurrentUser().photoURL;
                }

                if (avatarToStore && avatarToStore.length > MAX_AVATAR_BYTES) {
                    fb.textContent = 'Photo data is too large to store locally. Use a smaller image or a photo URL.';
                    fb.className = 'alert alert-danger mt-3 mb-0';
                    fb.classList.remove('d-none');
                    return;
                }

                localStorage.setItem('hershield_user_name', displayName);
                if (avatarToStore) localStorage.setItem('hershield_user_avatar', avatarToStore);
                else localStorage.removeItem('hershield_user_avatar');

                const ext = {
                    displayName,
                    age: document.getElementById('profileAge').value.trim(),
                    homeAddress: document.getElementById('profileHomeAddress').value.trim(),
                    personalPhone: document.getElementById('profilePersonalPhone').value.trim(),
                    bloodGroup: document.getElementById('profileBloodGroup').value,
                    allergies: document.getElementById('profileAllergies').value.trim(),
                    medications: document.getElementById('profileMedications').value.trim(),
                    photoUrl: photoUrlInput && /^https?:\/\//i.test(photoUrlInput) ? photoUrlInput : '',
                };
                saveExtendedProfile(ext);

                window.refreshHershieldSidebarProfile();
                window.dispatchEvent(new CustomEvent('hershield-profile-updated', { detail: { displayName } }));
                if (window.authService && typeof window.authService.updateFirebaseProfile === 'function') {
                    await window.authService.updateFirebaseProfile({
                        displayName,
                        photoURL: photoUrlInput && /^https?:\/\//i.test(photoUrlInput) ? photoUrlInput : null,
                    });
                }

                await syncProfileToBackend({
                    displayName,
                    personalPhone: ext.personalPhone,
                    age: ext.age,
                    homeAddress: ext.homeAddress,
                    bloodGroup: ext.bloodGroup,
                    allergies: ext.allergies,
                    medications: ext.medications,
                    profilePictureHttp:
                        photoUrlInput && /^https?:\/\//i.test(photoUrlInput) ? photoUrlInput : undefined,
                });

                fb.textContent = 'Profile saved.';
                fb.className = 'alert alert-success mt-3 mb-0';
                fb.classList.remove('d-none');
                setTimeout(() => profileModal.hide(), 600);
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
