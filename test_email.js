require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    console.log('📧 Testing Email Configuration...');
    console.log(`User: ${process.env.EMAIL_USER}`);

    // Try Gmail first
    try {
        console.log('Attempting to send via Gmail...');
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'Her Shield Test Email (Gmail)',
            text: 'If you receive this, Gmail configuration is working!'
        });
        console.log('✅ Gmail Sent Successfully!');
        console.log('Message ID:', info.messageId);
        return;
    } catch (error) {
        console.error('❌ Gmail Failed:', error.message);
        if (error.response) console.error('Server Response:', error.response);
    }

    // Fallback to Ethereal
    console.log('\n🔄 Switching to Ethereal Email (Fake SMTP) for testing...');
    try {
        const testAccount = await nodemailer.createTestAccount();
        const transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass,
            },
        });

        const info = await transporter.sendMail({
            from: '"Her Shield Test" <test@hershield.app>',
            to: "user@example.com",
            subject: "Her Shield Emergency Alert Test",
            text: "This is a simulated emergency alert. The email system logic is working.",
            html: "<b>This is a simulated emergency alert.</b><br>The email system logic is working."
        });

        console.log('✅ Ethereal Email Sent!');
        console.log('📨 Preview URL:', nodemailer.getTestMessageUrl(info));
        console.log('NOTE: Use this URL to view the email since Gmail is failing.');
    } catch (err) {
        console.error('❌ Ethereal Failed:', err);
    }
}

testEmail();
