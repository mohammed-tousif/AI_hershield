'use strict';
/**
 * Account lifecycle emails (welcome / verification approved / verification
 * rejected / deactivated) — sent via services/emailService.js (Gmail API,
 * not SMTP; see that file for why). Every function here is best-effort and
 * never throws — a failed email must never block the signup or admin action
 * that triggered it, so callers can fire-and-forget without awaiting.
 */
const emailService = require('./emailService');
const { getFrontendUrl } = require('../config/appUrls');

function wrap(title, bodyHtml) {
    return `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#FF9A86,#FFB399);padding:28px 24px;border-radius:16px 16px 0 0;text-align:center;">
            <div style="font-size:28px;">🛡️</div>
            <h1 style="color:#fff;margin:8px 0 0;font-size:19px;">HerShield</h1>
        </div>
        <div style="background:#fff;padding:28px 24px;border:1px solid #f0ddc7;border-top:none;border-radius:0 0 16px 16px;">
            <h2 style="margin:0 0 12px;color:#2b2117;font-size:17px;">${title}</h2>
            <div style="color:#4a4038;font-size:14px;line-height:1.7;">${bodyHtml}</div>
        </div>
        <p style="text-align:center;color:#a89e94;font-size:11px;margin-top:16px;">HerShield — Women Safety Platform</p>
    </div>`;
}

function button(href, label) {
    return `<p style="text-align:center;margin:24px 0 8px;">
        <a href="${href}" style="background:linear-gradient(135deg,#FF9A86,#FFB399);color:#fff;text-decoration:none;
            padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;display:inline-block;">${label}</a>
    </p>`;
}

async function send(to, subject, html) {
    if (!emailService.isConfigured() || !to) return;
    try {
        await emailService.sendMail({
            from: `"HerShield" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
    } catch (err) {
        console.warn('[Notify] Email failed:', subject, '->', err.message);
    }
}

function sendWelcomeEmail(user) {
    if (!user?.email) return;
    const name = user.name || 'there';
    const html = wrap(`Welcome to HerShield, ${name} 👋`, `
        <p>Your account has been created. HerShield is a women-only safety platform — thank you for joining.</p>
        <p>One last step: verify your account with a quick live selfie so our team can confirm it's really you.
           If you haven't already, you'll be prompted for this automatically the next time you sign in.</p>
        ${button(`${getFrontendUrl()}/dashboard.html`, 'Open HerShield')}
    `);
    return send(user.email, '👋 Welcome to HerShield', html);
}

function sendVerificationApprovedEmail(user) {
    if (!user?.email) return;
    const html = wrap('Your account is verified ✅', `
        <p>Good news — your identity verification has been approved. Your account now shows as
           <strong>verified</strong> across HerShield.</p>
        ${button(`${getFrontendUrl()}/dashboard.html`, 'Open HerShield')}
    `);
    return send(user.email, '✅ HerShield verification approved', html);
}

function sendVerificationRejectedEmail(user, reason, alsoDeactivated) {
    if (!user?.email) return;
    const reasonHtml = reason
        ? `<p style="background:#fdecea;border:1px solid #f7c1c1;border-radius:8px;padding:10px 14px;color:#a52834;">${reason}</p>`
        : '';
    const deactivatedNote = alsoDeactivated
        ? `<p><strong>Your account has also been deactivated</strong> and you won't be able to sign in until this is resolved. Please contact support if you believe this is a mistake.</p>`
        : `<p>You can submit a new selfie for review any time from your dashboard.</p>`;
    const html = wrap('Verification not approved', `
        <p>Your recent identity verification submission was not approved.</p>
        ${reasonHtml}
        ${deactivatedNote}
        ${alsoDeactivated ? '' : button(`${getFrontendUrl()}/dashboard.html`, 'Try again')}
    `);
    return send(user.email, 'HerShield verification update', html);
}

function sendAccountDeactivatedEmail(user) {
    if (!user?.email) return;
    const html = wrap('Your account has been deactivated', `
        <p>An administrator has deactivated your HerShield account. You won't be able to sign in while
           it's in this state.</p>
        <p>If you believe this is a mistake, please contact HerShield support.</p>
    `);
    return send(user.email, 'Your HerShield account has been deactivated', html);
}

module.exports = {
    sendWelcomeEmail,
    sendVerificationApprovedEmail,
    sendVerificationRejectedEmail,
    sendAccountDeactivatedEmail,
};
