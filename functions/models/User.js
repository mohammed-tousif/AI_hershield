const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const emergencyContactSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    relationship: {
        type: String,
        trim: true
    },
    priority: {
        type: Number,
        default: 1
    }
});

const userSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        unique: true,
        sparse: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    profilePicture: {
        type: String,
        default: 'https://i.pravatar.cc/150?img=32'
    },
    emergencyContacts: [emergencyContactSchema],
    safetyPreferences: {
        autoAlertEnabled: {
            type: Boolean,
            default: false
        },
        shareLocationByDefault: {
            type: Boolean,
            default: true
        },
        preferredAlertMethod: {
            type: String,
            enum: ['sms', 'whatsapp', 'both'],
            default: 'both'
        },
        nightModeAutoActivate: {
            type: Boolean,
            default: true
        }
    },
    statistics: {
        totalTrips: {
            type: Number,
            default: 0
        },
        safeTrips: {
            type: Number,
            default: 0
        },
        emergencyAlerts: {
            type: Number,
            default: 0
        },
        incidentReports: {
            type: Number,
            default: 0
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Update the updatedAt timestamp before saving
userSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Method to add emergency contact
userSchema.methods.addEmergencyContact = function (contact) {
    this.emergencyContacts.push(contact);
    return this.save();
};

// Method to remove emergency contact
userSchema.methods.removeEmergencyContact = function (contactId) {
    this.emergencyContacts.id(contactId).remove();
    return this.save();
};

// Method to update statistics
userSchema.methods.updateStats = function (statType, increment = 1) {
    if (this.statistics[statType] !== undefined) {
        this.statistics[statType] += increment;
        return this.save();
    }
    return Promise.reject(new Error('Invalid stat type'));
};

const User = mongoose.model('User', userSchema);

module.exports = User;
