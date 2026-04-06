const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const twilio = require('twilio');

class SMSService {
    constructor() {
        // Check if Twilio credentials are configured
        this.isConfigured = !!(
            process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            process.env.TWILIO_PHONE_NUMBER &&
            process.env.TWILIO_ACCOUNT_SID !== 'your_twilio_account_sid_here'
        );

        if (this.isConfigured) {
            this.client = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );
            this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
            console.log('✅ Twilio SMS Service initialized');
        } else {
            console.warn('⚠️  Twilio credentials not configured - SMS service running in mock mode');
        }
    }

    /**
     * Send emergency SOS alert via SMS
     * @param {Object} params - Alert parameters
     * @param {string} params.to - Recipient phone number
     * @param {string} params.userName - Name of person in emergency
     * @param {Object} params.location - Location coordinates
     * @param {string} params.trackingLink - Link to live tracking
     */
    async sendEmergencyAlert({ to, userName, location, trackingLink }) {
        const message = this.formatEmergencyMessage(userName, location, trackingLink);

        if (!this.isConfigured) {
            // Mock mode - log instead of sending
            console.log('📱 [MOCK SMS] Emergency alert would be sent to:', to);
            console.log('Message:', message);
            return {
                success: true,
                mock: true,
                sid: 'MOCK_' + Date.now(),
                to,
                message
            };
        }

        try {
            const result = await this.client.messages.create({
                body: message,
                from: this.fromNumber,
                to: to
            });

            console.log(`✅ Emergency SMS sent to ${to}: ${result.sid}`);
            return {
                success: true,
                sid: result.sid,
                to,
                status: result.status
            };
        } catch (error) {
            console.error(`❌ Failed to send SMS to ${to}:`, error.message);
            return {
                success: false,
                error: error.message,
                to
            };
        }
    }

    /**
     * Send location update via SMS
     */
    async sendLocationUpdate({ to, userName, location, message }) {
        const smsBody = `Her Shield Alert: ${userName} shared their location with you.\n\n${message || 'Current location:'}\n\nLat: ${location.latitude}\nLng: ${location.longitude}\n\nView on map: https://maps.google.com/?q=${location.latitude},${location.longitude}`;

        if (!this.isConfigured) {
            console.log('📱 [MOCK SMS] Location update would be sent to:', to);
            console.log('Message:', smsBody);
            return {
                success: true,
                mock: true,
                sid: 'MOCK_' + Date.now()
            };
        }

        try {
            const result = await this.client.messages.create({
                body: smsBody,
                from: this.fromNumber,
                to: to
            });

            return {
                success: true,
                sid: result.sid,
                to
            };
        } catch (error) {
            console.error(`❌ Failed to send location SMS to ${to}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send check-in notification
     */
    async sendCheckInNotification({ to, userName, location, checkInMessage }) {
        const message = `Her Shield Check-in: ${userName} checked in safely.\n\n${checkInMessage}\n\nLocation: https://maps.google.com/?q=${location.latitude},${location.longitude}\n\nTime: ${new Date().toLocaleString()}`;

        if (!this.isConfigured) {
            console.log('📱 [MOCK SMS] Check-in would be sent to:', to);
            return { success: true, mock: true };
        }

        try {
            const result = await this.client.messages.create({
                body: message,
                from: this.fromNumber,
                to: to
            });

            return { success: true, sid: result.sid };
        } catch (error) {
            console.error(`❌ Failed to send check-in SMS:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Format emergency message
     */
    formatEmergencyMessage(userName, location, trackingLink) {
        const googleMapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;

        return `🚨 EMERGENCY ALERT 🚨\n\n${userName} has triggered an emergency SOS!\n\nLast known location:\nLat: ${location.latitude}\nLng: ${location.longitude}\n\nView location: ${googleMapsLink}\n\n${trackingLink ? `Live tracking: ${trackingLink}\n\n` : ''}Please check on them immediately!\n\n- Her Shield Safety Network`;
    }

    /**
     * Send bulk SMS to multiple contacts
     */
    async sendBulkEmergencyAlerts(contacts, userName, location, trackingLink) {
        const results = [];

        for (const contact of contacts) {
            const result = await this.sendEmergencyAlert({
                to: contact.phone,
                userName,
                location,
                trackingLink
            });

            results.push({
                contactName: contact.name,
                contactPhone: contact.phone,
                ...result
            });

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return results;
    }

    /**
     * Validate phone number format
     */
    validatePhoneNumber(phone) {
        // Basic validation - should start with + and country code
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        return phoneRegex.test(phone);
    }

    /**
     * Format phone number to E.164 format
     */
    formatPhoneNumber(phone) {
        // Remove all non-digit characters except +
        let formatted = phone.replace(/[^\d+]/g, '');

        // If doesn't start with +, assume it's Indian number and add +91
        if (!formatted.startsWith('+')) {
            formatted = '+91' + formatted;
        }

        return formatted;
    }
}

module.exports = new SMSService();
