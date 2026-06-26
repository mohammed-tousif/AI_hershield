/**
 * End-to-end email diagnostic script
 * Tests the EXACT same nodemailer configuration used in liveTracker.js
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

console.log('=== HerShield Email Diagnostics ===\n');
console.log('1. Environment Check:');
console.log(`   EMAIL_USER: ${EMAIL_USER ? EMAIL_USER : '❌ MISSING'}`);
console.log(`   EMAIL_PASS: ${EMAIL_PASS ? '✅ Set (' + EMAIL_PASS.length + ' chars)' : '❌ MISSING'}`);

if (!EMAIL_USER || !EMAIL_PASS) {
    console.error('\n❌ FATAL: Email credentials missing. Cannot proceed.');
    process.exit(1);
}

// EXACT same config as routes/liveTracker.js
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
});

async function run() {
    // Step 1: Verify SMTP connection
    console.log('\n2. SMTP Connection Test:');
    try {
        const verified = await transporter.verify();
        console.log(`   ✅ SMTP connection verified: ${verified}`);
    } catch (err) {
        console.error(`   ❌ SMTP verify FAILED: ${err.message}`);
        console.error(`   Full error:`, err);
        process.exit(1);
    }

    // Step 2: Send test email to self
    console.log('\n3. Sending test email to self...');
    try {
        const info = await transporter.sendMail({
            from: `"HerShield Safety" <${EMAIL_USER}>`,
            to: EMAIL_USER,
            subject: `🧪 HerShield Email Test - ${new Date().toLocaleTimeString()}`,
            html: `<h2>Email Pipeline Working</h2>
                   <p>This confirms the nodemailer transporter config is correct.</p>
                   <p>Timestamp: ${new Date().toISOString()}</p>`,
        });
        console.log(`   ✅ Email sent! MessageId: ${info.messageId}`);
        console.log(`   Response: ${info.response}`);
    } catch (err) {
        console.error(`   ❌ Send FAILED: ${err.message}`);
        console.error(`   Code: ${err.code}`);
        console.error(`   Full error:`, err);
        process.exit(1);
    }

    // Step 3: Test with array of emails (like dashboard-alert does)
    console.log('\n4. Sending test email to array (like dashboard-alert)...');
    const testRecipients = [EMAIL_USER];
    try {
        const info = await transporter.sendMail({
            from: `"HerShield Safety" <${EMAIL_USER}>`,
            to: testRecipients,
            subject: `🧪 HerShield Array Test - ${new Date().toLocaleTimeString()}`,
            html: `<h2>Array Recipient Test</h2>
                   <p>Recipients: ${JSON.stringify(testRecipients)}</p>`,
        });
        console.log(`   ✅ Array email sent! MessageId: ${info.messageId}`);
    } catch (err) {
        console.error(`   ❌ Array send FAILED: ${err.message}`);
    }

    console.log('\n=== Diagnostic Complete ===');
}

run();
