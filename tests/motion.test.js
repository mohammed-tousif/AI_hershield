'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../motion.js'), 'utf8');

/** Minimal browser stand-in: enough for motion.js to boot and expose HSMotion. */
function boot({ reduced = false, fine = true, late = false, elements = {}, light = '', snippet = true } = {}) {
    const classes = new Set(late || !snippet ? [] : ['hs-motion']);
    const root = {
        dataset: late ? { hsLate: '1' } : {},
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
            contains: c => classes.has(c),
        },
        hasAttribute: () => false,
    };
    const document = {
        readyState: 'complete',
        documentElement: Object.assign(root, { scrollHeight: 2000 }),
        body: { dataset: light ? { motionReveal: light } : {} },
        querySelectorAll: selector => elements[selector] || [],
        addEventListener() {},
    };
    const window = {
        matchMedia: query => ({ matches: query.includes('reduce') ? reduced : query.includes('pointer: fine') ? fine : false }),
        addEventListener() {},
        innerHeight: 800, scrollY: 0,
    };
    const context = { window, document, requestAnimationFrame: () => 0, setTimeout: () => 0, performance: { now: () => 0 }, getComputedStyle: () => ({}), console,
        MutationObserver: class { observe() {} } };
    vm.runInNewContext(SOURCE, context);
    return { HSMotion: window.HSMotion, classes };
}

test('Counters format prefix/suffix correctly (the old landing page showed "%82" and "K29+")', () => {
    const { HSMotion } = boot();
    assert.equal(HSMotion.formatCount(24, { suffix: 'h' }), '24h');
    assert.equal(HSMotion.formatCount(2, { suffix: 's' }), '2s');
    assert.equal(HSMotion.formatCount(85, { suffix: '%' }), '85%');
    assert.equal(HSMotion.formatCount(30, { suffix: 'K+' }), '30K+');
    assert.equal(HSMotion.formatCount(0, { prefix: '₹' }), '₹0');
    assert.equal(HSMotion.formatCount(12.345, { decimals: 1 }), '12.3');
    assert.equal(HSMotion.formatCount(23.6), '24', 'mid-animation values round to whole numbers');
});

test('A counter always shows its true final value before and without animation', () => {
    const counter = { dataset: { count: '24', suffix: 'h' }, textContent: '' };
    const reduced = boot({ reduced: true, elements: { '[data-count]': [counter] } });
    assert.equal(counter.textContent, '24h', 'reduced motion: no count-up, correct value immediately');
    assert.equal(reduced.HSMotion.reduced, true);
});

test('Reduced motion never hides content and turns all motion off', () => {
    const { classes, HSMotion } = boot({ reduced: true });
    assert.equal(classes.has('hs-motion'), false, 'entrance-hiding styles are disabled');
    assert.equal(classes.has('hs-fine'), false, 'tilt/magnetic/parallax are disabled');
    assert.equal(HSMotion.reduced, true);
});

test('If motion.js arrived after the head failsafe showed the page, nothing is re-hidden', () => {
    const counter = { dataset: { count: '6' }, textContent: '' };
    const { classes } = boot({ late: true, elements: { '[data-count]': [counter] } });
    assert.equal(classes.has('hs-motion'), false);
    assert.equal(counter.textContent, '6', 'late counters keep the final value instead of restarting from 0');
});

test('App pages never hide a card that is already on screen; only later cards rise in', () => {
    const card = (top) => {
        const cls = new Set();
        const attrs = {};
        return {
            dataset: {}, style: { setProperty() {} }, cls,
            classList: { add: (...c) => c.forEach(x => cls.add(x)), contains: c => cls.has(c), remove: () => {} },
            hasAttribute: name => name in attrs, setAttribute: (name, value) => { attrs[name] = value; },
            addEventListener() {}, getBoundingClientRect: () => ({ top, bottom: top + 200 }),
        };
    };
    const onScreen = card(100), belowFold = card(1600);
    const selector = '.main-content .stat-card';
    // No head snippet on app pages: html.hs-motion is not set when motion.js starts.
    const { classes } = boot({ elements: { [selector]: [onScreen, belowFold] }, light: selector, snippet: false });
    assert.equal(classes.has('hs-motion'), true);
    assert.ok(onScreen.cls.has('is-in') && onScreen.cls.has('hs-revealed'), 'visible immediately, no entrance');
    assert.equal(belowFold.cls.has('is-in'), false, 'still waiting to rise in when scrolled to');
});

test('Normal desktop visitors get entrances and pointer effects', () => {
    const { classes } = boot({ reduced: false, fine: true });
    assert.equal(classes.has('hs-motion'), true);
    assert.equal(classes.has('hs-fine'), true);
});
