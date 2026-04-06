const mongoose = require('mongoose');

const incidentReportSchema = new mongoose.Schema({
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    reporterName: {
        type: String,
        required: true
    },
    incidentType: {
        type: String,
        required: true,
        enum: [
            'harassment',
            'assault',
            'theft',
            'suspicious_activity',
            'poor_lighting',
            'unsafe_area',
            'other'
        ]
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    location: {
        address: String,
        coordinates: {
            latitude: {
                type: Number,
                required: true
            },
            longitude: {
                type: Number,
                required: true
            }
        },
        landmark: String
    },
    description: {
        type: String,
        required: true,
        maxlength: 1000
    },
    incidentTime: {
        type: Date,
        required: true
    },
    timeOfDay: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'night'],
        required: true
    },
    images: [{
        url: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    status: {
        type: String,
        enum: ['pending', 'verified', 'investigating', 'resolved', 'rejected'],
        default: 'pending'
    },
    verificationScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 50
    },
    upvotes: {
        type: Number,
        default: 0
    },
    downvotes: {
        type: Number,
        default: 0
    },
    votedBy: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        voteType: {
            type: String,
            enum: ['up', 'down']
        },
        votedAt: {
            type: Date,
            default: Date.now
        }
    }],
    comments: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        userName: String,
        comment: {
            type: String,
            maxlength: 500
        },
        commentedAt: {
            type: Date,
            default: Date.now
        }
    }],
    policeReportFiled: {
        type: Boolean,
        default: false
    },
    policeReportNumber: String,
    isAnonymous: {
        type: Boolean,
        default: false
    },
    visibility: {
        type: String,
        enum: ['public', 'community', 'private'],
        default: 'public'
    },
    tags: [String],
    relatedIncidents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IncidentReport'
    }],
    adminNotes: String,
    resolvedAt: Date,
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

// Calculate time of day based on incident time
incidentReportSchema.pre('save', function (next) {
    if (this.incidentTime) {
        const hour = this.incidentTime.getHours();
        if (hour >= 5 && hour < 12) {
            this.timeOfDay = 'morning';
        } else if (hour >= 12 && hour < 17) {
            this.timeOfDay = 'afternoon';
        } else if (hour >= 17 && hour < 21) {
            this.timeOfDay = 'evening';
        } else {
            this.timeOfDay = 'night';
        }
    }
    next();
});

// Method to add upvote
incidentReportSchema.methods.addVote = function (userId, voteType) {
    // Check if user already voted
    const existingVote = this.votedBy.find(v => v.userId.toString() === userId.toString());

    if (existingVote) {
        // If same vote type, remove vote
        if (existingVote.voteType === voteType) {
            this.votedBy = this.votedBy.filter(v => v.userId.toString() !== userId.toString());
            if (voteType === 'up') this.upvotes--;
            else this.downvotes--;
        } else {
            // Change vote type
            existingVote.voteType = voteType;
            if (voteType === 'up') {
                this.upvotes++;
                this.downvotes--;
            } else {
                this.downvotes++;
                this.upvotes--;
            }
        }
    } else {
        // New vote
        this.votedBy.push({ userId, voteType });
        if (voteType === 'up') this.upvotes++;
        else this.downvotes++;
    }

    // Update verification score based on votes
    this.verificationScore = Math.min(100, 50 + (this.upvotes - this.downvotes) * 5);

    return this.save();
};

// Method to add comment
incidentReportSchema.methods.addComment = function (userId, userName, comment) {
    this.comments.push({ userId, userName, comment });
    return this.save();
};

// Indexes for faster queries
incidentReportSchema.index({ 'location.coordinates.latitude': 1, 'location.coordinates.longitude': 1 });
incidentReportSchema.index({ incidentType: 1, severity: 1 });
incidentReportSchema.index({ status: 1 });
incidentReportSchema.index({ createdAt: -1 });

const IncidentReport = mongoose.model('IncidentReport', incidentReportSchema);

module.exports = IncidentReport;
