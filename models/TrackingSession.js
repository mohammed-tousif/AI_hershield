const mongoose = require('mongoose');

const locationPointSchema = new mongoose.Schema({
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    speed: Number,
    heading: Number,
    timestamp: { type: Date, default: Date.now }
}, { _id: false });

const trackingSessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    trackingCode: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    name: String,
    phone: String,
    travelMode: {
        type: String,
        enum: ['walking', 'driving', 'public_transport', 'cycling'],
        default: 'walking'
    },
    startPoint: mongoose.Schema.Types.Mixed,
    destination: mongoose.Schema.Types.Mixed,
    estimatedDuration: Number,
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    status: {
        type: String,
        enum: ['active', 'completed', 'cancelled'],
        default: 'active'
    },
    currentLocation: locationPointSchema,
    locationHistory: { type: [locationPointSchema], default: [] },
    checkIns: {
        type: [{
            location: mongoose.Schema.Types.Mixed,
            message: String,
            timestamp: { type: Date, default: Date.now }
        }],
        default: []
    },
    emergencyAlerts: {
        type: [{
            location: mongoose.Schema.Types.Mixed,
            notificationsSent: { type: [String], default: [] },
            timestamp: { type: Date, default: Date.now }
        }],
        default: []
    },
    duration: Number,
    totalDistance: Number,
    safetyScore: Number,
    notes: String
}, { timestamps: true });

trackingSessionSchema.statics.generateTrackingCode = function () {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

trackingSessionSchema.methods.calculateDuration = function () {
    if (!this.startTime || !this.endTime) return 0;
    return Math.max(0, Math.round((this.endTime - this.startTime) / 1000));
};

trackingSessionSchema.methods.calculateDistance = function () {
    if (!this.locationHistory || this.locationHistory.length < 2) return 0;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371; // km
    let totalKm = 0;

    for (let i = 1; i < this.locationHistory.length; i++) {
        const a = this.locationHistory[i - 1];
        const b = this.locationHistory[i];
        if (a?.latitude == null || a?.longitude == null || b?.latitude == null || b?.longitude == null) {
            continue;
        }

        const dLat = toRad(b.latitude - a.latitude);
        const dLon = toRad(b.longitude - a.longitude);
        const lat1 = toRad(a.latitude);
        const lat2 = toRad(b.latitude);

        const h = Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        totalKm += R * c;
    }

    return Number(totalKm.toFixed(3));
};

module.exports = mongoose.model('TrackingSession', trackingSessionSchema);
