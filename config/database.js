const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getFirestoreAdmin } = require('./firestoreAdmin');

/**
 * App persistence is Cloud Firestore (Firebase Admin SDK).
 * MongoDB is not used for Her Shield API data.
 */
const connectDB = async () => {
    console.log('ℹ️  Persistence: Firestore. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON (see .env.example).');
    return null;
};

const checkDBHealth = () => {
    const fs = getFirestoreAdmin();
    return {
        firestore: {
            configured: !!fs,
            ready: !!fs,
        },
        mongo: { status: 'not_used', isConnected: false },
    };
};

module.exports = { connectDB, checkDBHealth };
