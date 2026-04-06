const IncidentReport = require('../models/IncidentReport');

class SafetyAnalyticsService {
    /**
     * Calculate safety score for a route
     * @param {Array} routePoints - Array of {lat, lng} points along the route
     * @param {number} timeOfDay - Hour of day (0-23)
     * @returns {Object} Safety analysis
     */
    async calculateRouteSafety(routePoints, timeOfDay = new Date().getHours()) {
        try {
            // Get all incident reports from database
            const incidents = await IncidentReport.find({
                status: { $in: ['verified', 'investigating'] }
            }).select('location severity incidentType timeOfDay');

            let totalRiskScore = 0;
            let highRiskSegments = [];
            const riskFactors = [];

            // Analyze each point on the route
            for (let i = 0; i < routePoints.length; i++) {
                const point = routePoints[i];
                const nearbyIncidents = this.findNearbyIncidents(
                    point,
                    incidents,
                    0.5 // 500 meters radius
                );

                if (nearbyIncidents.length > 0) {
                    const segmentRisk = this.calculateSegmentRisk(
                        nearbyIncidents,
                        timeOfDay
                    );

                    totalRiskScore += segmentRisk.score;

                    if (segmentRisk.score > 60) {
                        highRiskSegments.push({
                            point,
                            risk: segmentRisk.score,
                            incidents: nearbyIncidents.length
                        });
                    }

                    riskFactors.push(...segmentRisk.factors);
                }
            }

            // Calculate overall safety score (0-100, higher is safer)
            const avgRiskScore = routePoints.length > 0 ? totalRiskScore / routePoints.length : 0;
            const safetyScore = Math.max(0, Math.min(100, 100 - avgRiskScore));

            // Apply time-based adjustments
            const timeAdjustedScore = this.applyTimeAdjustment(safetyScore, timeOfDay);

            return {
                safetyScore: Math.round(timeAdjustedScore),
                riskLevel: this.getRiskLevel(timeAdjustedScore),
                highRiskSegments,
                riskFactors: [...new Set(riskFactors)], // Remove duplicates
                totalIncidentsNearby: incidents.length,
                recommendation: this.getRecommendation(timeAdjustedScore, timeOfDay)
            };
        } catch (error) {
            console.error('Error calculating route safety:', error);
            return {
                safetyScore: 50,
                riskLevel: 'unknown',
                error: error.message
            };
        }
    }

    /**
     * Find incidents near a point
     */
    findNearbyIncidents(point, incidents, radiusKm) {
        return incidents.filter(incident => {
            const distance = this.calculateDistance(
                point.lat,
                point.lng,
                incident.location.coordinates.latitude,
                incident.location.coordinates.longitude
            );
            return distance <= radiusKm;
        });
    }

    /**
     * Calculate risk score for a route segment
     */
    calculateSegmentRisk(incidents, timeOfDay) {
        let score = 0;
        const factors = [];

        incidents.forEach(incident => {
            // Base severity scores
            const severityScores = {
                critical: 40,
                high: 30,
                medium: 20,
                low: 10
            };

            score += severityScores[incident.severity] || 15;

            // Add to risk factors
            factors.push(incident.incidentType);

            // Time-based risk increase
            if (this.isNightTime(timeOfDay) && incident.timeOfDay === 'night') {
                score += 10;
                factors.push('night_time_risk');
            }
        });

        return { score, factors };
    }

    /**
     * Apply time-based adjustment to safety score
     */
    applyTimeAdjustment(score, hour) {
        // Night time (9 PM - 5 AM) reduces safety score
        if (hour >= 21 || hour < 5) {
            return score * 0.8; // 20% reduction
        }
        // Early morning (5 AM - 7 AM)
        else if (hour >= 5 && hour < 7) {
            return score * 0.9; // 10% reduction
        }
        // Daytime (7 AM - 6 PM)
        else if (hour >= 7 && hour < 18) {
            return score * 1.1; // 10% boost
        }
        // Evening (6 PM - 9 PM)
        else {
            return score * 0.95; // 5% reduction
        }
    }

    /**
     * Get risk level category
     */
    getRiskLevel(score) {
        if (score >= 80) return 'low';
        if (score >= 60) return 'medium';
        if (score >= 40) return 'high';
        return 'critical';
    }

    /**
     * Get safety recommendation
     */
    getRecommendation(score, timeOfDay) {
        const isNight = this.isNightTime(timeOfDay);

        if (score >= 80) {
            return isNight
                ? 'Route is relatively safe, but stay alert during night hours.'
                : 'Route appears safe. Enjoy your journey!';
        } else if (score >= 60) {
            return 'Route has moderate risk. Stay in well-lit areas and remain alert.';
        } else if (score >= 40) {
            return 'Route has elevated risk. Consider alternative routes or travel with companions.';
        } else {
            return 'Route has high risk. Strongly recommend choosing an alternative route or delaying travel.';
        }
    }

    /**
     * Check if time is night
     */
    isNightTime(hour) {
        return hour >= 21 || hour < 5;
    }

    /**
     * Calculate distance between two points (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     */
    toRad(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Generate heatmap data for map visualization
     */
    async generateHeatmapData(bounds, timeOfDay) {
        try {
            const incidents = await IncidentReport.find({
                status: { $in: ['verified', 'investigating'] },
                'location.coordinates.latitude': {
                    $gte: bounds.south,
                    $lte: bounds.north
                },
                'location.coordinates.longitude': {
                    $gte: bounds.west,
                    $lte: bounds.east
                }
            });

            return incidents.map(incident => {
                const baseWeight = this.getIncidentWeight(incident.severity);
                const timeWeight = this.isNightTime(timeOfDay) ? 1.5 : 1.0;

                return {
                    lat: incident.location.coordinates.latitude,
                    lng: incident.location.coordinates.longitude,
                    weight: baseWeight * timeWeight,
                    type: incident.incidentType,
                    severity: incident.severity
                };
            });
        } catch (error) {
            console.error('Error generating heatmap data:', error);
            return [];
        }
    }

    /**
     * Get weight for incident based on severity
     */
    getIncidentWeight(severity) {
        const weights = {
            critical: 10,
            high: 7,
            medium: 4,
            low: 2
        };
        return weights[severity] || 3;
    }
}

module.exports = new SafetyAnalyticsService();
