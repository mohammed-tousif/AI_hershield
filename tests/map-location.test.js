'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { requestPosition, validPosition } = require('../map-location');
const position = (accuracy, timestamp = Date.now()) => ({ coords: { latitude: 15.3, longitude: 75.1, accuracy }, timestamp });
function provider() {
    const state = { cleared: [], calls: 0 };
    state.watchPosition = (success, error, options) => { state.success = success; state.error = error; state.options = options; state.calls++; return 42; };
    state.clearWatch = id => state.cleared.push(id);
    return state;
}
test('Location waits through a coarse reading, accepts an accurate update, and clears its watch', async () => {
    const geo = provider(); let settled = false;
    const pending = requestPosition({ geolocation: geo, timeout: 100 }).then(p => { settled = true; return p; });
    geo.success(position(15000)); await Promise.resolve(); assert.equal(settled, false);
    geo.success(position(25)); const result = await pending;
    assert.equal(result.coords.accuracy, 25); assert.deepEqual(geo.cleared, [42]);
    assert.deepEqual(geo.options, { enableHighAccuracy: true, maximumAge: 0, timeout: 100 });
});
test('The best usable approximate reading is returned at the deadline, not a later worse reading', async () => {
    const geo = provider(), pending = requestPosition({ geolocation: geo, timeout: 15 });
    geo.success(position(350)); geo.success(position(1400));
    assert.equal((await pending).coords.accuracy, 350); assert.deepEqual(geo.cleared, [42]);
});
test('City-level and unknown-accuracy readings never become current-location pins', async () => {
    const geo = provider(), pending = requestPosition({ geolocation: geo, timeout: 15 });
    const rejected = assert.rejects(pending, /No current-location pin/);
    geo.success(position(25000)); await rejected;
    for (const accuracy of [undefined, null, NaN, Infinity, -1]) assert.equal(validPosition(position(accuracy)), false);
    assert.equal(validPosition(position(20, Date.now() - 60000)), false);
    assert.equal(validPosition({ ...position(20), coords: { latitude: 91, longitude: 75, accuracy: 20 } }), false);
});
test('Blocked permission and silent providers fail with actionable errors and release watches', async () => {
    const denied = provider(), first = requestPosition({ geolocation: denied });
    const rejected = assert.rejects(first, /permission is blocked/);
    denied.error({ code: 1 }); await rejected; assert.deepEqual(denied.cleared, [42]);
    const silent = provider(); await assert.rejects(requestPosition({ geolocation: silent, timeout: 15 }), /timed out/);
    assert.deepEqual(silent.cleared, [42]);
});
test('Leaving the page cancels location acquisition and ignores subsequent callbacks', async () => {
    const geo = provider(), controller = new AbortController();
    const pending = requestPosition({ geolocation: geo, signal: controller.signal });
    const rejected = assert.rejects(pending, /cancelled/); controller.abort(); geo.success(position(10)); await rejected;
    assert.deepEqual(geo.cleared, [42]);
});
test('Map recenter shares one request, displays uncertainty, and recovers after permission failure', async () => {
    const geo = provider(), status = {}, button = {}, map = { setCenter() {}, setZoom() {} }, circles = [];
    const window = { navigator: { geolocation: geo }, addEventListener() {}, google: { maps: {
        SymbolPath: { CIRCLE: 'circle' }, Marker: class { setMap() {} },
        Circle: class { constructor(options) { circles.push(options); } setMap() {} }
    } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../map-location'), 'utf8'), { window, Date, AbortController, setTimeout, clearTimeout });
    const locator = new window.HSMapLocation.MapLocation({ getMap: () => map, status, buttons: [button] });
    const first = locator.locate(); assert.equal(locator.locate(), first); assert.equal(geo.calls, 1); assert.equal(button.disabled, true);
    geo.success(position(40)); await first;
    assert.match(status.textContent, /accuracy ±40 m/); assert.equal(circles[0].radius, 40); assert.equal(button.disabled, false);
    const second = locator.locate(); geo.error({ code: 1 }); assert.equal(await second, null);
    assert.equal(locator.marker, null); assert.equal(button.disabled, false); assert.match(status.textContent, /not a confirmed current location/);
});
test('Safety-data refresh updates overlays without recreating the map or asking for location again', async () => {
    const source = fs.readFileSync(require.resolve('../safety-map.html'), 'utf8');
    const start = source.indexOf('async function loadSafetyData()');
    const end = source.indexOf('/** Push a single new incident', start);
    const map = {}; let initialized = 0, layers = 0;
    const context = { window: { google: { maps: {} } }, map, console: { log() {}, warn() {}, error() {} },
        fetch: async () => ({ ok: true, json: async () => ({ data: [], points: [] }) }),
        initMap: () => initialized++, createHeatmap: () => layers++, createMarkers: () => layers++, populateLocationFilter() {}, updateStatistics() {} };
    vm.createContext(context); vm.runInContext(source.slice(start, end), context);
    await context.loadSafetyData(); assert.equal(initialized, 0); assert.equal(layers, 2); assert.equal(context.map, map);
});
