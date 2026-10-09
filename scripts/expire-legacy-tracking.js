'use strict';
// Default: read-only audit. Apply only during a coordinated maintenance window.
function legacyPatch(collection, data, deleteValue) {
    const hasPin = Object.prototype.hasOwnProperty.call(data, 'pin');
    const weakHash = data.pinHash && !/^\$2[aby]\$/.test(data.pinHash);
    const tracking = collection !== 'hershield_sos_events';
    const unsafeShare = tracking && (!/^[A-F0-9]{64}$/.test(data.trackingCode || '') || !data.shareExpiresAt ||
        (collection === 'hershield_live_tracker_sessions' && !data.ownerUid));
    if (!hasPin && !weakHash && !unsafeShare) return null;
    const patch = {};
    if (hasPin) patch.pin = deleteValue;
    if (weakHash) patch.pinHash = deleteValue;
    if (tracking) {
        patch.shareExpiresAt = new Date(0).toISOString();
        patch.trackingCode = deleteValue;
        patch.trackingLink = deleteValue;
        if (collection === 'hershield_live_tracker_sessions') patch.isTrackingActive = false;
        else if (data.status === 'active') patch.status = 'expired';
    } else if (data.status === 'active') patch.status = 'expired';
    return patch;
}
async function main() {
    const args=process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('Read-only: node scripts/expire-legacy-tracking.js\nApply: node scripts/expire-legacy-tracking.js --apply --project-id <exact-project-id>'); return;
    }
    require('dotenv').config({quiet:true});
    const db=require('../config/firestoreAdmin').getFirestoreAdmin();
    if (!db) throw Error('Firestore credentials are required.');
    const apply=args.includes('--apply');
    const index=args.indexOf('--project-id');
    if (apply && (index < 0 || args[index+1] !== db.projectId)) throw Error('Apply requires the exact configured --project-id.');
    const admin=require('firebase-admin');
    const report={mode:apply?'apply':'read-only',collections:{}};
    for (const collection of ['hershield_live_tracker_sessions','hershield_tracking_sessions','hershield_sos_events']) {
        let last=null; const counts={scanned:0,affected:0};
        while (true) {
            let query=db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(200);
            if(last)query=query.startAfter(last);
            const page=await query.get(); if(page.empty)break;
            for(const doc of page.docs) {
                counts.scanned++;
                if(!legacyPatch(collection,doc.data(),admin.firestore.FieldValue.delete()))continue;
                counts.affected++;
                if(apply) await db.runTransaction(async tx=>{
                    const current=await tx.get(doc.ref);
                    if(!current.exists)return;
                    const patch=legacyPatch(collection,current.data(),admin.firestore.FieldValue.delete());
                    if(patch)tx.update(doc.ref,patch);
                });
            }
            last=page.docs.at(-1);
        }
        report.collections[collection]=counts;
    }
    console.log(JSON.stringify(report,null,2)); // No PIN, share token, location or personal data in output.
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={legacyPatch};
