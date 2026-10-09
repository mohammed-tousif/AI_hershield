/* Email status is fetched from the server; no localStorage verification flag. */
(() => {
    'use strict';
    const page = document.getElementById('emailVerificationPage');
    if (!page && /(?:[?&])(code|track)=/.test(location.search)) return; // Public tracking viewer.
    const byId = id => document.getElementById(id);
    let busy = false, resendAt = 0, timer, sent = false;
    const next = new URLSearchParams(location.search).get('next') === 'identity' ? 'verify-identity.html' : 'dashboard.html';
    async function request(action, body) {
        const response = await fetch('/api/email-verification/' + action, body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await response.json();
        if (data.retryAfter) resendAt = Math.max(resendAt, Date.now() + data.retryAfter * 1000);
        if (!response.ok || !data.success) throw new Error(data.message || 'Email verification is unavailable. Please retry.');
        return data;
    }
    function message(text, error = false) {
        byId('emailStatus').textContent = text;
        byId('emailStatus').dataset.error = String(error);
    }
    function controls() {
        if (!page) return;
        const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
        byId('emailSend').disabled = busy || wait > 0;
        byId('emailSend').textContent = wait ? `Request another code in ${wait}s` : sent ? 'Resend verification code' : 'Send verification code';
        byId('emailVerify').disabled = busy;
        byId('emailCode').disabled = busy;
        byId('emailRetry').disabled = busy;
    }
    function verified(data) {
        byId('emailAddress').textContent = data.email;
        byId('emailCodeSection').hidden = true;
        byId('emailRetry').hidden = true;
        byId('emailContinue').hidden = false;
        byId('emailContinue').href = next;
        byId('emailHeading').textContent = 'All yours.';
        byId('emailIntro').textContent = 'Your email address is verified. You’re ready to continue.';
        message('Verified email address');
        byId('emailCode').value = '';
        clearInterval(timer);
    }
    async function send() {
        if (busy) return;
        busy = true; controls(); message('Sending your verification code…');
        try {
            const data = await request('send', {});
            if (data.verified) return verified(data);
            sent = true;
            message('Code sent. Check your inbox; delivery can take a moment. The code expires in 5 minutes.');
        } catch (error) { message(error.message, true); }
        finally { busy = false; controls(); if (!byId('emailCodeSection').hidden) byId('emailCode').focus(); }
    }
    async function load() {
        if (busy) return;
        busy = true; controls();
        let autoSend = false;
        try {
            const user = await window.getHerShieldUser();
            if (!user) { if (page) location.replace('auth.html'); return; }
            const data = await request('status');
            if (page) {
                byId('emailRetry').hidden = true;
                byId('emailAddress').textContent = data.email;
                if (data.verified) return verified(data);
                sent = data.expiresIn > 0;
                byId('emailCodeSection').hidden = false;
                message(sent ? 'A code is already on its way or in your inbox. Enter it below.' : 'Your email is unverified. Request a code to verify it.');
                autoSend = next === 'verify-identity.html' && !sent && !data.retryAfter;
            } else renderBanner(data);
        } catch (error) {
            if (page) { message(error.message, true); byId('emailRetry').hidden = false; }
            else renderBanner(null);
        } finally { busy = false; controls(); }
        if (autoSend) await send();
    }
    function renderBanner(data) {
        let banner = byId('hsEmailBanner');
        if (!banner) {
            const host = document.querySelector('.main-content,.verify-container');
            if (!host) return;
            banner = document.createElement('aside'); banner.id = 'hsEmailBanner'; banner.className = 'hs-email-banner';
            banner.setAttribute('aria-label', 'Email verification status'); host.prepend(banner);
        }
        banner.replaceChildren(); banner.dataset.verified = String(data?.verified === true);
        const text = document.createElement('span');
        text.textContent = data ? data.verified ? '✓ Verified email address' : 'Your email is unverified. Verify it with a one-time code.' : 'Unable to check your email verification status.';
        const link = document.createElement('a'); link.href = 'verify-email.html';
        link.textContent = data?.verified ? 'View email status' : 'Verify email';
        banner.append(text, link);
        const profileLink = byId('profileEmailVerification');
        if (profileLink) profileLink.textContent = data?.verified ? 'Verified email address · View status' : 'Verify your email address';
    }
    if (page) {
        byId('emailSend').addEventListener('click', send);
        byId('emailRetry').addEventListener('click', load);
        byId('emailCodeForm').addEventListener('submit', async event => {
            event.preventDefault(); if (busy) return;
            busy = true; controls(); message('Checking your code…');
            try {
                const data = await request('verify', { code: byId('emailCode').value.trim() });
                if (data.verified !== true) throw new Error('The server has not confirmed verification. Please check your email status.');
                verified(data);
            }
            catch (error) { message(error.message, true); }
            finally { busy = false; controls(); }
        });
        timer = setInterval(controls, 1000);
        window.addEventListener('pagehide', () => clearInterval(timer));
    } else {
        // Refresh the status after returning from verification in another tab.
        window.addEventListener('focus', load);
    }
    void load();
})();
