'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {legacyPatch}=require('../scripts/expire-legacy-tracking');
test('Legacy migration removes PIN material and expires unsafe shares without marking anyone safe',()=>{
    const patch=legacyPatch('hershield_live_tracker_sessions',{pin:'1234',pinHash:'old-sha',isTrackingActive:true},'DELETE');
    assert.equal(patch.pin,'DELETE');assert.equal(patch.pinHash,'DELETE');assert.equal(patch.isTrackingActive,false);
    assert.equal(patch.trackingCode,'DELETE');
    assert.equal(legacyPatch('hershield_sos_events',{pinHash:'old-sha',status:'active'},'DELETE').status,'expired');
});
test('Legacy migration preserves newly secured journeys',()=>{
    const value={pinHash:'$2b$12$synthetic',ownerUid:'test',trackingCode:'A'.repeat(64),shareExpiresAt:new Date().toISOString()};
    assert.equal(legacyPatch('hershield_live_tracker_sessions',value,'DELETE'),null);
});
