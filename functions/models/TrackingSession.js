const mongoose = require('mongoose');

const locationPointSchema = new mongoose.Schema({
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    accuracy: Number,
    timestamp: {
        type: Date,
        default: Date.now
    },
    speed: Number,
    heading: Number
});

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
        uppercase: true
    },
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    travelMode: {
        type: String,
        enum: ['walking', 'driving', 'public_transport', 'cycling'],
        default: 'walking'
    },
    startPoint: {
        address: String,
        coordinates: {
            latitude: Number,
            longitude: Number
        }
    },
    destination: {
        address: String,
        coordinates: {
            latitude: Number,
            longitude: Number
        }
    },
    estimatedDuration: {
        type: Number, // in minutes
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'emergency', 'cancelled'],
        default: 'active'
    },
    locationHistory: [locationPointSchema],
    currentLocation: locationPointSchema,
    emergencyAlerts: [{
        triggeredAt: {
            type: Date,
            default: Date.now
        },
        location: locationPointSchema,
        notificationsSent: [{
            contactName: String,
            contactPhone: String,
            method: {
                type: String,
                enum: ['sms', 'whatsapp']
            },
            status: {
                type: String,
                enum: ['sent', 'failed', 'delivered']
            },
            sentAt: Date
        }],
        resolved: {
            type: Boolean,
            default: false
        },
        resolvedAt: Date
    }],
    checkIns: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        location: locationPointSchema,
        message: String
    }],
    sharedWith: [{
        name: String,
        phone: String,
        sharedAt: {
            type: Date,
            default: Date.now
        }
    }],
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: Date,
    duration: Number, // in seconds
    totalDistance: Number, // in meters
    safetyScore: {
        type: Number,
        min: 0,
        max: 100
    },
    notes: String
}, {
    timestamps: true
});

// Generate unique tracking code
trackingSessionSchema.statics.generateTrackingCode = function () {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
};

// Calculate session duration
trackingSessionSchema.methods.calculateDuration = function () {
    if (this.endTime && this.startTime) {
        this.duration = Math.floor((this.endTime - this.startTime) / 1000);
    }
    return this.duration;
};

// Calculate total distance traveled
trackingSessionSchema.methods.calculateDistance = function () {
    if (this.locationHistory.length < 2) {
        this.totalDistance = 0;
        return 0;
    }

    let totalDistance = 0;
    for (let i = 1; i < this.locationHistory.length; i++) {
        const prev = this.locationHistory[i - 1];
        const curr = this.locationHistory[i];
        totalDistance += calculateDistanceBetweenPoints(
            prev.latitude, prev.longitude,
            curr.latitude, curr.longitude
        );
    }

    this.totalDistance = totalDistance;
    return totalDistance;
};

// Helper function to calculate distance between two points (Haversine formula)
function calculateDistanceBetweenPoints(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Index for faster queries
trackingSessionSchema.index({ userId: 1, status: 1 });
trackingSessionSchema.index({ trackingCode: 1 });
trackingSessionSchema.index({ startTime: -1 });

const TrackingSession = mongoose.model('TrackingSession', trackingSessionSchema);

module.exports = TrackingSession;
