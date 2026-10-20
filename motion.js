/**
 * HerShield signature motion layer (shared, dependency-free). Lenis
 * (lenis.min.js) is used for smooth scrolling only when present and the page
 * opts in with <html data-smooth-scroll>.
 *
 * Declarative hooks:
 *   [data-reveal]             rise/fade in once when scrolled into view
 *                             ("up" default | "left" | "right" | "zoom" | "fade")
 *   [data-reveal-delay="ms"]  stagger
 *   [data-split]              kinetic heading: words rise through a mask ("chars" = letters)
 *   [data-count="n"]          count up to n (data-prefix / data-suffix / data-decimals);
 *                             the markup already holds the final text for no-JS readers
 *   [data-tilt="deg"]         3D tilt + glare toward the pointer (fine pointers only)
 *   [data-magnetic]           element leans toward the pointer (fine pointers only)
 *   [data-depth-scene]        pointer-driven 3D scene; children [data-depth="n"] sit
 *                             on depth planes (fine pointers only). It follows the
 *                             pointer over the nearest [data-depth-area] or <section>.
 *   [data-scroll-progress]    scaleX bar following page scroll
 *   [data-emblem]             glossy CSS 3D shield emblem (built here; decorative)
 *   <body data-motion-reveal="selector" data-motion-tilt="selector">
 *                             light layer for app pages, including cards rendered later
 *
 * Under prefers-reduced-motion nothing moves; touch devices keep native
 * scrolling and get reveals + press feedback only. Hidden "before" states
 * apply only while html.hs-motion is set: marketing pages set it early with an
 * inline head snippet (which drops it again if this script never arrives);
 * app pages have no snippet, so cards already on screen are never hidden and
 * only cards that arrive later rise in.
 */
(() => {
    'use strict';
    const root = document.documentElement;
    const matches = query => !!(window.matchMedia && window.matchMedia(query).matches);
    const REDUCED = matches('(prefers-reduced-motion: reduce)');
    const FINE = matches('(hover: hover) and (pointer: fine)');
    const MOTION = !REDUCED;
    // Set by the inline head snippet when this script took too long and content
    // was already shown statically: never hide it again (that would flicker).
    const LATE = root.dataset.hsLate === '1';
    const ENTRANCES = MOTION && !LATE;
    // Pages without the head snippet (the app pages' light layer) never hide
    // anything early: cards already on screen when this runs appear instantly,
    // and only cards arriving later (scrolled to, or rendered afterwards) rise in.
    // An app page behind slow CDN scripts must never show missing cards.
    const EARLY_HIDE = root.classList.contains('hs-motion');
    let instantInView = !EARLY_HIDE;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    /** Pure: "24" + "h" etc. Exported for tests. */
    function formatCount(value, { prefix = '', suffix = '', decimals = 0 } = {}) {
        const n = Number(value);
        const text = Number.isFinite(n)
            ? n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
            : '';
        return prefix + text + suffix;
    }

    /** Wrap a heading's words (or letters) in masked spans; keeps nested markup. */
    function splitText(el, chars = false) {
        if (el.dataset.splitDone) return;
        el.dataset.splitDone = '1';
        if (chars) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
        let n = 0;
        const walk = (node, carry) => {
            Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === 3) {
                    const frag = document.createDocumentFragment();
                    child.textContent.split(/(\s+)/).forEach(part => {
                        if (!part) return;
                        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
                        (chars ? Array.from(part) : [part]).forEach(unit => {
                            const w = document.createElement('span');
                            w.className = 'hs-w';
                            if (chars) w.setAttribute('aria-hidden', 'true');
                            const inner = document.createElement('span');
                            inner.className = 'hs-wi' + (carry ? ' ' + carry : '');
                            inner.textContent = unit;
                            inner.style.setProperty('--hs-i', String(n++));
                            w.appendChild(inner);
                            frag.appendChild(w);
                        });
                    });
                    child.replaceWith(frag);
                } else if (child.nodeType === 1 && child.tagName !== 'BR') {
                    // background-clip:text does not survive transformed inline-blocks,
                    // so a gradient host hands its gradient to each word instead.
                    let nextCarry = carry;
                    if (child.classList.contains('gradient-text')) { child.classList.add('hs-gradient-host'); nextCarry = 'gradient-text'; }
                    walk(child, nextCarry);
                }
            });
        };
        walk(el, el.classList.contains('gradient-text') ? 'gradient-text' : '');
        if (el.classList.contains('gradient-text')) el.classList.add('hs-gradient-host');
    }

    // ── Glossy 3D shield emblem ────────────────────────────────────────────
    const SPRITE_ID = 'hs-emblem-sprite';
    function ensureSprite() {
        if (document.getElementById(SPRITE_ID)) return;
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.id = SPRITE_ID;
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        svg.innerHTML =
            '<defs>' +
            '<linearGradient id="hsFace" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc4b3"/><stop offset=".45" stop-color="#ff9a86"/><stop offset="1" stop-color="#e2604c"/></linearGradient>' +
            '<linearGradient id="hsRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe3d6"/><stop offset="1" stop-color="#f27a64"/></linearGradient>' +
            '<linearGradient id="hsGloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
            '<radialGradient id="hsHeart" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffe9e1"/></radialGradient>' +
            '<symbol id="hsShield" viewBox="0 0 120 140"><path d="M60 5 108 23v43c0 32-21 57-48 69C33 123 12 98 12 66V23Z"/></symbol>' +
            '</defs>';
        document.body.prepend(svg);
    }
    function buildEmblem(el) {
        if (el.dataset.emblemDone) return;
        el.dataset.emblemDone = '1';
        ensureSprite();
        el.setAttribute('aria-hidden', 'true');
        el.classList.add('hs-emblem');
        let layers = '';
        // Stacked back layers give the shield real thickness when it turns.
        for (let i = 9; i >= 1; i--) layers += '<svg class="hs-em-layer" viewBox="0 0 120 140" style="--l:' + i + '"><use href="#hsShield"/></svg>';
        el.innerHTML =
            '<div class="hs-em-float"><div class="hs-em-body">' + layers +
            '<svg class="hs-em-face" viewBox="0 0 120 140">' +
            '<use href="#hsShield" fill="url(#hsFace)" stroke="url(#hsRim)" stroke-width="3"/>' +
            '<path d="M60 102C44 91 33 80 33 66c0-9 7-16 15-16 5 0 9 2 12 6 3-4 7-6 12-6 8 0 15 7 15 16 0 14-11 25-27 36Z" fill="url(#hsHeart)"/>' +
            '<path d="M24 30 60 16v40C46 48 33 44 24 44Z" fill="url(#hsGloss)" opacity=".55"/>' +
            '</svg></div></div><div class="hs-em-floor"></div>';
    }

    // ── Light layer for app pages (cards may be rendered later) ───────────
    const body = document.body;
    const lightReveal = body?.dataset.motionReveal || '';
    const lightTilt = body?.dataset.motionTilt || '';

    const pendingReveal = new Set();
    const pendingSplit = new Set();
    const pendingCount = new Set();
    const tilted = new WeakSet();

    function prepareReveal(el) {
        if (el.dataset.hsReveal) return;
        el.dataset.hsReveal = '1';
        if (!el.hasAttribute('data-reveal')) {
            // Light layer: stagger by how many cards appear together (set per frame),
            // not by list position — the 20th post shouldn't wait the longest.
            el.setAttribute('data-reveal', 'up');
            el.dataset.hsAutoDelay = '1';
        } else if (el.dataset.revealDelay) {
            el.style.setProperty('--hs-delay', parseInt(el.dataset.revealDelay, 10) + 'ms');
        }
        if (!ENTRANCES) { el.classList.add('is-in', 'hs-revealed'); return; }
        if (instantInView) {
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight && r.bottom > 0) { el.classList.add('is-in', 'hs-revealed'); return; }
        }
        el.addEventListener('animationend', event => {
            if (event.target === el && event.animationName.startsWith('hs-reveal')) el.classList.add('hs-revealed');
        });
        pendingReveal.add(el);
    }

    function prepareCount(el) {
        if (el.dataset.hsCount) return;
        el.dataset.hsCount = '1';
        const options = { prefix: el.dataset.prefix || '', suffix: el.dataset.suffix || '', decimals: parseInt(el.dataset.decimals || '0', 10) };
        const target = Number(el.dataset.count);
        el.textContent = formatCount(target, options); // always correct, even before animating
        if (!ENTRANCES || !Number.isFinite(target)) return;
        el.textContent = formatCount(0, options);
        el._hsCount = { target, options };
        pendingCount.add(el);
    }
    function runCount(el) {
        const { target, options } = el._hsCount;
        const start = performance.now(), duration = 1600;
        let done = false;
        const tick = now => {
            if (done) return;
            const p = Math.min(1, (now - start) / duration);
            const eased = p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);
            el.textContent = formatCount(p >= 1 ? target : target * eased, options);
            if (p < 1) requestAnimationFrame(tick); else done = true;
        };
        requestAnimationFrame(tick);
        // A number must never be left showing a wrong value if frames stall.
        setTimeout(() => { done = true; el.textContent = formatCount(target, options); }, duration + 150);
    }

    function setupTilt(el) {
        if (tilted.has(el) || !FINE || !MOTION) return;
        tilted.add(el);
        if (!el.hasAttribute('data-tilt')) el.setAttribute('data-tilt', '5');
        const max = parseFloat(el.dataset.tilt) || 6;
        if (!el.querySelector(':scope > .hs-glare')) {
            const glare = document.createElement('span');
            glare.className = 'hs-glare';
            glare.setAttribute('aria-hidden', 'true');
            el.appendChild(glare);
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        }
        let frame = null, px = 0.5, py = 0.5;
        const paint = () => {
            frame = null;
            el.style.setProperty('--hs-rx', ((0.5 - py) * max).toFixed(2) + 'deg');
            el.style.setProperty('--hs-ry', ((px - 0.5) * max * 1.3).toFixed(2) + 'deg');
            el.style.setProperty('--hs-gx', (px * 100).toFixed(1) + '%');
            el.style.setProperty('--hs-gy', (py * 100).toFixed(1) + '%');
        };
        el.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse') return;
            const r = el.getBoundingClientRect();
            px = clamp((event.clientX - r.left) / r.width, 0, 1);
            py = clamp((event.clientY - r.top) / r.height, 0, 1);
            el.classList.add('is-tilting');
            if (!frame) frame = requestAnimationFrame(paint);
        });
        el.addEventListener('pointerleave', () => {
            el.classList.remove('is-tilting');
            el.style.setProperty('--hs-rx', '0deg');
            el.style.setProperty('--hs-ry', '0deg');
        });
    }

    function setupMagnetic(el) {
        if (!FINE || !MOTION) return;
        let tx = 0, ty = 0, cx = 0, cy = 0, frame = null;
        const strength = parseFloat(el.dataset.magnetic) || 0.28;
        const loop = () => {
            cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;
            el.style.translate = cx.toFixed(2) + 'px ' + cy.toFixed(2) + 'px';
            if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) frame = requestAnimationFrame(loop);
            else { frame = null; if (!tx && !ty) el.style.translate = ''; }
        };
        el.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse') return;
            const r = el.getBoundingClientRect();
            tx = (event.clientX - (r.left - cx + r.width / 2)) * strength;
            ty = (event.clientY - (r.top - cy + r.height / 2)) * strength;
            if (!frame) frame = requestAnimationFrame(loop);
        });
        el.addEventListener('pointerleave', () => { tx = 0; ty = 0; if (!frame) frame = requestAnimationFrame(loop); });
    }

    function setupDepthScene(scene) {
        scene.querySelectorAll('[data-depth]').forEach(layer => layer.style.setProperty('--hs-d', layer.dataset.depth));
        if (!FINE || !MOTION) return;
        const area = scene.closest('[data-depth-area], section') || scene;
        let tx = 0, ty = 0, cx = 0, cy = 0, frame = null;
        const loop = () => {
            cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
            scene.style.setProperty('--hs-px', cx.toFixed(4));
            scene.style.setProperty('--hs-py', cy.toFixed(4));
            if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) frame = requestAnimationFrame(loop); else frame = null;
        };
        area.addEventListener('pointermove', event => {
            if (event.pointerType !== 'mouse') return;
            const r = scene.getBoundingClientRect();
            tx = clamp((event.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), -1, 1);
            ty = clamp((event.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2), -1, 1);
            if (!frame) frame = requestAnimationFrame(loop);
        });
        area.addEventListener('pointerleave', () => { tx = 0; ty = 0; if (!frame) frame = requestAnimationFrame(loop); });
    }

    function scan(scope = document) {
        scope.querySelectorAll('[data-emblem]').forEach(buildEmblem);
        scope.querySelectorAll('[data-split]').forEach(el => {
            if (el.classList.contains('split-in')) return;
            splitText(el, el.dataset.split === 'chars');
            if (!ENTRANCES) el.classList.add('split-in'); else pendingSplit.add(el);
        });
        scope.querySelectorAll('[data-reveal]').forEach(el => prepareReveal(el));
        scope.querySelectorAll('[data-count]').forEach(prepareCount);
        scope.querySelectorAll('[data-tilt]').forEach(setupTilt);
        scope.querySelectorAll('[data-magnetic]').forEach(setupMagnetic);
        scope.querySelectorAll('[data-depth-scene]').forEach(setupDepthScene);
        if (lightReveal) scope.querySelectorAll(lightReveal).forEach(el => prepareReveal(el));
        if (lightTilt) scope.querySelectorAll(lightTilt).forEach(setupTilt);
    }

    // ── One rAF-throttled scroll pass for everything scroll-linked ─────────
    const frameHooks = [];
    const progressBars = Array.from(document.querySelectorAll('[data-scroll-progress]'));
    let ticking = false;
    function frame() {
        ticking = false;
        const vh = window.innerHeight, y = window.scrollY;
        const max = document.documentElement.scrollHeight - vh;
        progressBars.forEach(bar => { bar.style.transform = 'scaleX(' + (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4) + ')'; });
        const line = vh * 0.9;
        let batch = 0;
        pendingReveal.forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.top < line && r.bottom > -40) {
                if (el.dataset.hsAutoDelay) el.style.setProperty('--hs-delay', Math.min(batch++, 6) * 70 + 'ms');
                el.classList.add('is-in'); pendingReveal.delete(el);
            }
            else if (r.bottom <= -40) { el.classList.add('is-in', 'hs-revealed'); pendingReveal.delete(el); } // jumped past it
        });
        pendingSplit.forEach(el => { if (el.getBoundingClientRect().top < vh * 0.92) { el.classList.add('split-in'); pendingSplit.delete(el); } });
        pendingCount.forEach(el => { if (el.getBoundingClientRect().top < vh * 0.88) { pendingCount.delete(el); runCount(el); } });
        frameHooks.forEach(hook => { try { hook({ y, vh, max }); } catch (error) { console.error(error); } });
    }
    // Some embedded webviews starve requestAnimationFrame; the timer fallback
    // guarantees content is never left hidden waiting for a frame.
    const kick = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(frame);
        setTimeout(() => { if (ticking) frame(); }, 250);
    };

    // ── Smooth scrolling (opt-in, desktop fine pointers only) ─────────────
    let lenis = null;
    function setupLenis() {
        if (!root.hasAttribute('data-smooth-scroll') || !FINE || !MOTION || !window.Lenis) return;
        try {
            lenis = new window.Lenis({ duration: 1.15, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
            const raf = time => { lenis.raf(time); requestAnimationFrame(raf); };
            requestAnimationFrame(raf);
            lenis.on('scroll', kick);
            // Bootstrap dialogs scroll natively; pause page smoothing while one is open.
            document.addEventListener('show.bs.modal', () => lenis.stop());
            document.addEventListener('hidden.bs.modal', () => { if (!document.querySelector('.modal.show')) lenis.start(); });
        } catch (error) { lenis = null; console.warn('Smooth scroll unavailable:', error); }
    }
    const navOffset = () => parseFloat(getComputedStyle(root).scrollPaddingTop) || 80;
    function scrollToTarget(target, immediate = false) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (el == null) return;
        if (lenis) { lenis.scrollTo(el, { offset: -navOffset(), immediate, duration: 1.3, force: true }); return; }
        if (typeof el === 'number') { window.scrollTo({ top: el, behavior: immediate || REDUCED ? 'auto' : 'smooth' }); return; }
        el.scrollIntoView({ behavior: immediate || REDUCED ? 'auto' : 'smooth', block: 'start' });
    }
    document.addEventListener('click', event => {
        const link = event.target.closest?.('a[href^="#"]');
        // Bootstrap tabs/collapses/modals own their "#id" links.
        if (!link || link.getAttribute('href').length < 2 || event.defaultPrevented || link.hasAttribute('data-bs-toggle')) return;
        let target = null;
        try { target = document.querySelector(link.getAttribute('href')); } catch { return; }
        if (!target) return;
        event.preventDefault();
        scrollToTarget(target);
        history.replaceState(null, '', link.getAttribute('href'));
    });

    function init() {
        root.classList.toggle('hs-motion', ENTRANCES);
        root.classList.toggle('hs-fine', FINE && MOTION);
        scan(); // same task as adding hs-motion, so in-view cards never paint hidden
        instantInView = false;
        setupLenis();
        if (lightReveal || lightTilt) {
            let queued = false;
            new MutationObserver(records => {
                if (queued || !records.some(r => r.addedNodes.length)) return;
                queued = true;
                requestAnimationFrame(() => { queued = false; scan(); kick(); });
            }).observe(document.body, { childList: true, subtree: true });
        }
        window.addEventListener('scroll', kick, { passive: true });
        window.addEventListener('resize', kick, { passive: true });
        window.addEventListener('load', kick);
        kick();
    }

    window.HSMotion = {
        reduced: REDUCED, fine: FINE, formatCount, splitText,
        scrollTo: scrollToTarget,
        onFrame: hook => { frameHooks.push(hook); kick(); },
        refresh: () => { scan(); kick(); },
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
