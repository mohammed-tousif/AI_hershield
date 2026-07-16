// Her Shield — Firebase Authentication Service
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    FacebookAuthProvider,
    OAuthProvider,
    updateProfile,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    getAdditionalUserInfo,
    EmailAuthProvider,
    linkWithCredential,
    deleteUser
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-config.js";

/**
 * Upsert a Firestore user document after every Firebase Auth sign-in.
 * Uses Firebase UID as the document key so the admin dashboard can
 * look up any user in O(1) without secondary indexes.
 */
async function syncUserToFirestore(user) {
    if (!user || !user.uid) return;
    try {
        const body = {
            firebaseUid: user.uid,
            email: user.email || '',
            name: user.displayName || user.email?.split('@')[0] || 'Her Shield User',
            photoURL: user.photoURL || null,
        };
        const res = await fetch('/api/users/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            // Cache the backend user ID (= Firebase UID) for profile/contact API calls
            localStorage.setItem('hershield_backend_user_id', user.uid);
            console.log('✅ User synced to Firestore:', user.uid);

            // ── Restore profile picture from Firestore if not already in localStorage ──
            // This makes the avatar survive logout / browser clears / new devices.
            const hasLocalAvatar = !!localStorage.getItem('hershield_user_avatar');
            if (!hasLocalAvatar) {
                try {
                    const profileRes = await fetch(`/api/users/profile/${encodeURIComponent(user.uid)}`);
                    if (profileRes.ok) {
                        const profileData = await profileRes.json();
                        const storedPic = profileData?.user?.profilePicture;
                        if (storedPic && /^https?:\/\//i.test(storedPic)) {
                            localStorage.setItem('hershield_user_avatar', storedPic);
                            console.log('✅ Profile picture restored from Firestore:', storedPic);
                            // Refresh all avatar elements on the page
                            document.querySelectorAll('.user-avatar, .profile-avatar').forEach(img => {
                                img.src = storedPic;
                            });
                            if (typeof window.refreshHershieldSidebarProfile === 'function') {
                                window.refreshHershieldSidebarProfile();
                            }
                        }
                    }
                } catch (profileErr) {
                    console.warn('⚠️ Could not restore profile picture:', profileErr.message);
                }
            }
        } else {
            console.warn('⚠️ Firestore upsert returned', res.status);
        }
    } catch (e) {
        // Non-fatal: profile/contact ops will retry the lookup
        console.warn('⚠️ Firestore user sync skipped (offline?):', e.message);
    }
}

class FirebaseAuthService {
    constructor() {
        this.currentUser = null;
        this.authStateListeners = [];
        this.initAuthStateListener();
    }

    initAuthStateListener() {
        onAuthStateChanged(auth, async (user) => {
            this.currentUser = user;

            if (user) {
                // Ensure localStorage is in sync
                localStorage.setItem('hershield_logged_in', 'true');
                localStorage.setItem('hershield_user_email', user.email);
                if (!localStorage.getItem('hershield_user_name')) {
                    localStorage.setItem(
                        'hershield_user_name',
                        user.displayName || user.email.split('@')[0]
                    );
                }

                // ── Restore profile picture on every page load ──────────────
                // If localStorage has no avatar, or only a temporary base64
                // (which won't survive clearing), fetch from Firestore.
                const localAv = localStorage.getItem('hershield_user_avatar');
                const isBase64 = localAv && localAv.startsWith('data:');
                if (!localAv || isBase64) {
                    try {
                        const uid = user.uid;
                        const profileRes = await fetch(`/api/users/profile/${encodeURIComponent(uid)}`);
                        if (profileRes.ok) {
                            const profileData = await profileRes.json();
                            const storedPic = profileData?.user?.profilePicture;
                            if (storedPic && /^https?:\/\//i.test(storedPic)) {
                                localStorage.setItem('hershield_user_avatar', storedPic);
                                console.log('✅ Profile picture restored on page load:', storedPic);
                            }
                        }
                    } catch (_) { /* non-fatal */ }
                }
            } else {
                // Clear localStorage on logout
                localStorage.removeItem('hershield_logged_in');
                localStorage.removeItem('hershield_user_email');
                localStorage.removeItem('hershield_user_name');
                localStorage.removeItem('hershield_user_avatar');
                localStorage.removeItem('hershield_user_profile');
                localStorage.removeItem('hershield_backend_user_id');
            }

            this.notifyAuthStateListeners(user);
            this.updateUI(user);
        });
    }

    addAuthStateListener(callback) {
        this.authStateListeners.push(callback);
    }

    removeAuthStateListener(callback) {
        this.authStateListeners = this.authStateListeners.filter(listener => listener !== callback);
    }

    notifyAuthStateListeners(user) {
        this.authStateListeners.forEach(callback => callback(user));
    }

    updateUI(user) {
        const authElements = document.querySelectorAll('.auth-required');
        const guestElements = document.querySelectorAll('.guest-only');

        if (user) {
            // User is signed in
            authElements.forEach(el => el.style.display = 'block');
            guestElements.forEach(el => el.style.display = 'none');

            // Update user info in navigation
            this.updateUserInfo(user);
        } else {
            // User is signed out
            authElements.forEach(el => el.style.display = 'none');
            guestElements.forEach(el => el.style.display = 'block');
        }
    }

    updateUserInfo(user) {
        // Update user avatar and name in navigation (local custom avatar overrides provider photo)
        const userAvatars = document.querySelectorAll('.user-avatar, .profile-avatar');
        const userNames = document.querySelectorAll('.user-name, .profile-name');
        const userEmails = document.querySelectorAll('.user-email');

        userAvatars.forEach((avatar) => {
            const local = localStorage.getItem('hershield_user_avatar');
            if (local) {
                avatar.src = local;
                return;
            }
            if (user.photoURL) {
                avatar.src = user.photoURL;
            } else {
                avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=FF9A86&color=fff`;
            }
        });

        userNames.forEach((name) => {
            name.textContent =
                localStorage.getItem('hershield_user_name') || user.displayName || user.email.split('@')[0];
        });

        userEmails.forEach(email => {
            email.textContent = user.email;
        });
    }

    async loginWithEmail(email, password) {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_email', user.email);
            localStorage.setItem('hershield_user_name', user.displayName || user.email.split('@')[0]);

            // Sync / create Firestore user document
            await syncUserToFirestore(user);

            return { success: true, user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async registerWithEmail(email, password, displayName) {
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            if (displayName) {
                await updateProfile(user, { displayName });
            }

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_email', user.email);
            localStorage.setItem('hershield_user_name', displayName || user.email.split('@')[0]);

            // Sync / create Firestore user document
            await syncUserToFirestore({ ...user, displayName: displayName || user.displayName });

            return { success: true, user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * @param {'login'|'signup'} mode - Firebase's signInWithPopup does not
     * distinguish "log into an existing account" from "create a new one" —
     * it silently creates an account the first time any Google identity is
     * used. We enforce the distinction ourselves via isNewUser:
     *   - mode 'login'  + isNewUser  -> reject: delete the just-created
     *     account, sign out, tell the user to sign up first.
     *   - mode 'login'  + !isNewUser -> normal login (existing behavior).
     *   - mode 'signup' + isNewUser  -> real signup; caller (auth.html) must
     *     then collect phone + the ToS/gender declaration (and optionally a
     *     password to link) via a follow-up step — result.isNewUser signals this.
     *   - mode 'signup' + !isNewUser -> reject: sign out, tell the user this
     *     Google account is already registered, to log in instead.
     */
    async loginWithGoogle(mode = 'login') {
        try {
            const provider = new GoogleAuthProvider();
            provider.addScope('profile');
            provider.addScope('email');

            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const isNewUser = !!getAdditionalUserInfo(result)?.isNewUser;

            if (mode === 'login' && isNewUser) {
                // Firebase already created this account under the hood — undo it
                // rather than silently log the user into a brand-new account.
                try { await deleteUser(user); } catch (_) { /* best-effort */ }
                await signOut(auth);
                return { success: false, error: 'Account not found. Please sign up first.', code: 'no-account' };
            }

            if (mode === 'signup' && !isNewUser) {
                await signOut(auth);
                return { success: false, error: 'This Google account is already registered. Please log in instead.', code: 'already-exists' };
            }

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_email', user.email);
            localStorage.setItem('hershield_user_name', user.displayName);

            // Sync / create Firestore user document
            await syncUserToFirestore(user);

            return { success: true, user, isNewUser };
        } catch (error) {
            console.error('Google sign-in error:', error);

            let errorMessage = error.message;
            if (error.code === 'auth/popup-blocked') {
                errorMessage = 'Popup was blocked. Please allow popups for this site.';
            } else if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = 'Sign-in cancelled.';
            } else if (error.code === 'auth/unauthorized-domain') {
                errorMessage = 'This domain is not authorized for Google sign-in. Please contact support.';
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = 'Google sign-in is not enabled. Please contact support.';
            }

            return { success: false, error: errorMessage };
        }
    }

    /**
     * Links an email/password credential to the currently signed-in user
     * (used right after a Google signup, so the account can also log in
     * with email/password afterward). Non-fatal on failure — Google sign-in
     * keeps working regardless.
     */
    async linkPassword(password) {
        if (!this.currentUser) return { success: false, error: 'Not signed in' };
        try {
            const credential = EmailAuthProvider.credential(this.currentUser.email, password);
            await linkWithCredential(this.currentUser, credential);
            return { success: true };
        } catch (error) {
            console.warn('Password linking failed:', error);
            return { success: false, error: error.message };
        }
    }

    async loginWithFacebook() {
        try {
            const provider = new FacebookAuthProvider();
            provider.addScope('email');
            provider.addScope('public_profile');

            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_email', user.email);
            localStorage.setItem('hershield_user_name', user.displayName);

            // Sync / create Firestore user document
            await syncUserToFirestore(user);

            return { success: true, user };
        } catch (error) {
            console.error('Facebook sign-in error:', error);

            let errorMessage = error.message;
            if (error.code === 'auth/popup-blocked') {
                errorMessage = 'Popup was blocked. Please allow popups for this site.';
            } else if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = 'Sign-in cancelled.';
            } else if (error.code === 'auth/account-exists-with-different-credential') {
                errorMessage = 'An account already exists with the same email. Please use a different sign-in method.';
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = 'Facebook sign-in is not enabled. Please contact support.';
            }

            return { success: false, error: errorMessage };
        }
    }

    async loginWithApple() {
        try {
            const provider = new OAuthProvider('apple.com');
            provider.addScope('email');
            provider.addScope('name');

            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_email', user.email);
            localStorage.setItem('hershield_user_name', user.displayName);

            // Sync / create Firestore user document
            await syncUserToFirestore(user);

            return { success: true, user };
        } catch (error) {
            console.error('Apple sign-in error:', error);

            let errorMessage = error.message;
            if (error.code === 'auth/popup-blocked') {
                errorMessage = 'Popup was blocked. Please allow popups for this site.';
            } else if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = 'Sign-in cancelled.';
            } else if (error.code === 'auth/operation-not-allowed') {
                errorMessage = 'Apple sign-in is not enabled. Please contact support.';
            }

            return { success: false, error: errorMessage };
        }
    }

    async resetPassword(email) {
        try {
            await sendPasswordResetEmail(auth, email);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Phone Authentication Methods
    setupRecaptcha(containerId) {
        try {
            if (!window.recaptchaVerifier) {
                window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
                    'size': 'invisible',
                    'callback': (response) => {
                        console.log('reCAPTCHA solved');
                    },
                    'expired-callback': () => {
                        console.log('reCAPTCHA expired');
                    }
                });
            }
            return window.recaptchaVerifier;
        } catch (error) {
            console.error('reCAPTCHA setup error:', error);
            throw error;
        }
    }

    async sendOTP(phoneNumber) {
        try {
            // Setup reCAPTCHA
            const recaptchaVerifier = this.setupRecaptcha('recaptcha-container');

            // Send OTP
            const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);

            // Store confirmation result for OTP verification
            window.confirmationResult = confirmationResult;

            return { success: true, message: 'OTP sent successfully' };
        } catch (error) {
            console.error('Send OTP error:', error);

            let errorMessage = error.message;
            if (error.code === 'auth/invalid-phone-number') {
                errorMessage = 'Invalid phone number format. Please use format: +1234567890';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many requests. Please try again later.';
            } else if (error.code === 'auth/quota-exceeded') {
                errorMessage = 'SMS quota exceeded. Please try again tomorrow.';
            }

            return { success: false, error: errorMessage };
        }
    }

    async verifyOTP(otpCode) {
        try {
            if (!window.confirmationResult) {
                throw new Error('Please request OTP first');
            }

            const result = await window.confirmationResult.confirm(otpCode);
            const user = result.user;

            localStorage.setItem('hershield_logged_in', 'true');
            localStorage.setItem('hershield_user_phone', user.phoneNumber);
            localStorage.setItem('hershield_user_name', user.phoneNumber);

            // Sync / create Firestore user document
            await syncUserToFirestore(user);

            return { success: true, user };
        } catch (error) {
            console.error('Verify OTP error:', error);

            let errorMessage = error.message;
            if (error.code === 'auth/invalid-verification-code') {
                errorMessage = 'Invalid OTP code. Please try again.';
            } else if (error.code === 'auth/code-expired') {
                errorMessage = 'OTP code expired. Please request a new one.';
            }

            return { success: false, error: errorMessage };
        }
    }

    async logout() {
        try {
            await signOut(auth);

            // Clear localStorage
            localStorage.removeItem('hershield_logged_in');
            localStorage.removeItem('hershield_user_email');
            localStorage.removeItem('hershield_user_name');
            localStorage.removeItem('hershield_user_avatar');
            localStorage.removeItem('hershield_user_profile');
            localStorage.removeItem('hershield_backend_user_id');

            // Use replace to prevent back button from returning to protected pages
            window.location.replace('auth.html');

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getCurrentUser() {
        return this.currentUser;
    }

    isLoggedIn() {
        return this.currentUser !== null;
    }

    getUserEmail() {
        return this.currentUser ? this.currentUser.email : null;
    }

    getUserDisplayName() {
        return this.currentUser ? this.currentUser.displayName : null;
    }

    /**
     * Sync display name (and optional https photo URL) to Firebase Auth.
     * Custom uploaded images stay in localStorage only unless you paste a public URL.
     */
    async updateFirebaseProfile({ displayName, photoURL }) {
        if (!this.currentUser) return { success: false, error: 'Not signed in' };
        try {
            const updates = {};
            if (displayName) updates.displayName = displayName;
            if (photoURL && /^https?:\/\//i.test(photoURL)) updates.photoURL = photoURL;
            if (Object.keys(updates).length === 0) return { success: true };
            await updateProfile(this.currentUser, updates);
            if (displayName) localStorage.setItem('hershield_user_name', displayName);
            this.updateUI(this.currentUser);
            if (typeof window.refreshHershieldSidebarProfile === 'function') {
                window.refreshHershieldSidebarProfile();
            }
            return { success: true };
        } catch (error) {
            console.warn('Firebase profile update:', error);
            return { success: false, error: error.message };
        }
    }
}

// Create global auth service instance
const authService = new FirebaseAuthService();

// Export for use in other modules
export default authService;

// Make available globally
window.authService = authService;
