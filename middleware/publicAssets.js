'use strict';
const express = require('express');
// Deployment and local serving share this explicit list. Never serve the repository.
const PUBLIC_FILES = new Set([
    'index.html', 'auth.html', 'dashboard.html', 'live-tracker.html',
    'community.html', 'safety-map.html', 'verify-identity.html',
    'admin-login.html', 'admin-dashboard.html', 'config.js', 'firebase-config.js',
    'firebase-auth.js', 'navigation.js', 'styles.css', 'responsive.css', 'responsive.js',
    'animations.js', 'live-tracker.js', 'live-tracker-viewer.js', 'front.png', 'download (1).jpg',
    'verify-email.html', 'email-verification.js', 'email-verification.css',
]);
function publicAssets(root) {
    const serve = express.static(root, { dotfiles: 'deny', index: false, redirect: false });
    return (req, res, next) => {
        let pathname;
        try { pathname = decodeURIComponent(req.path); } catch { return res.sendStatus(400); }
        if (pathname === '/') pathname = '/index.html';
        if (!PUBLIC_FILES.has(pathname.slice(1))) return next();
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (pathname.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
        if (req.path === '/') req.url = '/index.html';
        return serve(req, res, next);
    };
}
module.exports = { publicAssets, PUBLIC_FILES };
