require('dotenv').config();

class WhatsAppService {
    constructor() {
        // Check if WhatsApp credentials are configured
        this.isConfigured = !!(
            process.env.WHATSAPP_API_KEY &&
            process.env.WHATSAPP_PHONE_NUMBER &&
            process.env.WHATSAPP_API_KEY !== 'your_whatsapp_api_key_here'
        );

        if (this.isConfigured) {
            this.apiKey = process.env.WHATSAPP_API_KEY;
            this.fromNumber = process.env.WHATSAPP_PHONE_NUMBER;
            console.log('✅ WhatsApp Service initialized');
        } else {
            console.warn('⚠️  WhatsApp credentials not configured - WhatsApp service running in mock mode');
        }
    }

    /**
     * Send emergency alert via WhatsApp
     * Note: This is a placeholder for WhatsApp Business API integration
     * Actual implementation requires Meta Business verification and API setup
     */
    async sendEmergencyAlert({ to, userName, location, trackingLink }) {
        const message = this.formatEmergencyMessage(userName, location, trackingLink);

        if (!this.isConfigured) {
            console.log('💬 [MOCK WhatsApp] Emergency alert would be sent to:', to);
            console.log('Message:', message);
            return {
                success: true,
                mock: true,
                messageId: 'MOCK_WA_' + Date.now(),
                to,
                message
            };
        }

        // TODO: Implement actual WhatsApp Business API call
        // This requires Meta Business verification and proper API setup
        // For now, return mock response
        console.log('💬 WhatsApp message would be sent to:', to);
        return {
            success: true,
            mock: true,
            messageId: 'WA_' + Date.now(),
            to,
            note: 'WhatsApp Business API integration pending Meta verification'
        };
    }

    /**
     * Send location via WhatsApp
     */
    async sendLocationUpdate({ to, userName, location, message }) {
        const googleMapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
        const whatsappMessage = `*Her Shield Location Update*\n\n${userName} shared their location:\n\n${message || ''}\n\n📍 ${googleMapsLink}\n\n_Sent via Her Shield Safety Network_`;

        if (!this.isConfigured) {
            console.log('💬 [MOCK WhatsApp] Location update would be sent to:', to);
            return {
                success: true,
                mock: true,
                messageId: 'MOCK_WA_' + Date.now()
            };
        }

        // TODO: Implement actual WhatsApp API call
        return {
            success: true,
            mock: true,
            messageId: 'WA_' + Date.now(),
            note: 'WhatsApp Business API integration pending'
        };
    }

    /**
     * Format emergency message for WhatsApp
     */
    formatEmergencyMessage(userName, location, trackingLink) {
        const googleMapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;

        return `🚨 *EMERGENCY ALERT* 🚨\n\n*${userName}* has triggered an emergency SOS!\n\n*Last known location:*\n📍 ${googleMapsLink}\n\n${trackingLink ? `*Live tracking:*\n🔗 ${trackingLink}\n\n` : ''}⚠️ Please check on them immediately!\n\n_Her Shield Safety Network_`;
    }

    /**
     * Send bulk WhatsApp messages
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

            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return results;
    }

    /**
     * Send check-in notification via WhatsApp
     */
    async sendCheckInNotification({ to, userName, location, checkInMessage }) {
        const googleMapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
        const message = `✅ *Her Shield Check-in*\n\n${userName} checked in safely.\n\n${checkInMessage}\n\n📍 Location: ${googleMapsLink}\n\n🕐 Time: ${new Date().toLocaleString()}\n\n_Her Shield Safety Network_`;

        if (!this.isConfigured) {
            console.log('💬 [MOCK WhatsApp] Check-in would be sent to:', to);
            return { success: true, mock: true };
        }

        return {
            success: true,
            mock: true,
            messageId: 'WA_' + Date.now()
        };
    }
}

module.exports = new WhatsAppService();
