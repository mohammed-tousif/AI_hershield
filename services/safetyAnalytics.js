const { incidentsFetchAll, isFirestoreConfigured } = require('./firestoreRepository');

const ACTIVE_STATUSES = ['verified', 'investigating', 'pending'];

async function loadActiveIncidents() {
    if (!isFirestoreConfigured()) return [];
    try {
        const all = await incidentsFetchAll();
        return all.filter((i) => ACTIVE_STATUSES.includes(i.status));
    } catch (e) {
        console.warn('loadActiveIncidents:', e.message);
        return [];
    }
}

class SafetyAnalyticsService {
    /**
     * Calculate safety score for a route
     * @param {Array} routePoints - Array of {lat, lng} points along the route
     * @param {number} timeOfDay - Hour of day (0-23)
     * @returns {Object} Safety analysis
     */
    async calculateRouteSafety(routePoints, timeOfDay = new Date().getHours()) {
        try {
            const incidents = await loadActiveIncidents();

            let totalRiskScore = 0;
            const highRiskSegments = [];
            const riskFactors = [];

            for (let i = 0; i < routePoints.length; i++) {
                const point = routePoints[i];
                const nearbyIncidents = this.findNearbyIncidents(point, incidents, 0.5);

                if (nearbyIncidents.length > 0) {
                    const segmentRisk = this.calculateSegmentRisk(nearbyIncidents, timeOfDay);

                    totalRiskScore += segmentRisk.score;

                    if (segmentRisk.score > 60) {
                        highRiskSegments.push({
                            point,
                            risk: segmentRisk.score,
                            incidents: nearbyIncidents.length,
                        });
                    }

                    riskFactors.push(...segmentRisk.factors);
                }
            }

            const avgRiskScore = routePoints.length > 0 ? totalRiskScore / routePoints.length : 0;
            const safetyScore = Math.max(0, Math.min(100, 100 - avgRiskScore));

            const timeAdjustedScore = this.applyTimeAdjustment(safetyScore, timeOfDay);
            const capped = Math.max(0, Math.min(100, timeAdjustedScore));

            return {
                safetyScore: Math.round(capped),
                riskLevel: this.getRiskLevel(capped),
                highRiskSegments,
                riskFactors: [...new Set(riskFactors)],
                totalIncidentsNearby: incidents.length,
                recommendation: this.getRecommendation(capped, timeOfDay),
            };
        } catch (error) {
            console.error('Error calculating route safety:', error);
            return {
                safetyScore: 50,
                riskLevel: 'unknown',
                error: error.message,
            };
        }
    }

    findNearbyIncidents(point, incidents, radiusKm) {
        return incidents.filter((incident) => {
            const lat = incident?.location?.coordinates?.latitude;
            const lng = incident?.location?.coordinates?.longitude;
            if (lat == null || lng == null) return false;
            const distance = this.calculateDistance(point.lat, point.lng, lat, lng);
            return distance <= radiusKm;
        });
    }

    calculateSegmentRisk(incidents, timeOfDay) {
        let score = 0;
        const factors = [];

        incidents.forEach((incident) => {
            const severityScores = {
                critical: 40,
                high: 30,
                medium: 20,
                low: 10,
            };

            score += severityScores[incident.severity] || 15;

            factors.push(incident.incidentType);

            if (this.isNightTime(timeOfDay) && incident.timeOfDay === 'night') {
                score += 10;
                factors.push('night_time_risk');
            }
        });

        return { score, factors };
    }

    applyTimeAdjustment(score, hour) {
        if (hour >= 21 || hour < 5) {
            return score * 0.8;
        }
        if (hour >= 5 && hour < 7) {
            return score * 0.9;
        }
        if (hour >= 7 && hour < 18) {
            return score * 1.1;
        }
        return score * 0.95;
    }

    getRiskLevel(score) {
        if (score >= 80) return 'low';
        if (score >= 60) return 'medium';
        if (score >= 40) return 'high';
        return 'critical';
    }

    getRecommendation(score, timeOfDay) {
        const isNight = this.isNightTime(timeOfDay);

        if (score >= 80) {
            return isNight
                ? 'Route is relatively safe, but stay alert during night hours.'
                : 'Route appears safe. Enjoy your journey!';
        }
        if (score >= 60) {
            return 'Route has moderate risk. Stay in well-lit areas and remain alert.';
        }
        if (score >= 40) {
            return 'Route has elevated risk. Consider alternative routes or travel with companions.';
        }
        return 'Route has high risk. Strongly recommend choosing an alternative route or delaying travel.';
    }

    isNightTime(hour) {
        return hour >= 21 || hour < 5;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(degrees) {
        return degrees * (Math.PI / 180);
    }

    async generateHeatmapData(bounds, timeOfDay) {
        try {
            const incidents = await loadActiveIncidents();

            return incidents
                .filter((incident) => {
                    const lat = incident?.location?.coordinates?.latitude;
                    const lng = incident?.location?.coordinates?.longitude;
                    if (lat == null || lng == null) return false;
                    return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
                })
                .map((incident) => {
                    const baseWeight = this.getIncidentWeight(incident.severity);
                    const timeWeight = this.isNightTime(timeOfDay) ? 1.5 : 1.0;

                    return {
                        lat: incident.location.coordinates.latitude,
                        lng: incident.location.coordinates.longitude,
                        weight: baseWeight * timeWeight,
                        type: incident.incidentType,
                        severity: incident.severity,
                    };
                });
        } catch (error) {
            console.error('Error generating heatmap data:', error);
            return [];
        }
    }

    getIncidentWeight(severity) {
        const weights = {
            critical: 10,
            high: 7,
            medium: 4,
            low: 2,
        };
        return weights[severity] || 3;
    }
}

module.exports = new SafetyAnalyticsService();
