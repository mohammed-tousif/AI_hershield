# Her Shield — Complete Project Documentation

## 📋 Project Overview
**HerShield: AI-powered Women Safety System** — real-time location tracking, emergency SOS, community safety mapping, predictive analytics, and room for AI/ML features on the backend.

---

## 🏗️ Architecture Overview

### Recommended hosting (hybrid)
- **Firebase:** Authentication, **Cloud Firestore** (real-time alerts, profiles, SOS/session metadata), optional Hosting for the static web app, FCM for push when you add it.
- **Render:** Node.js **Express** API (`server.js`), Socket.IO, optional **AI/ML** workers or model endpoints, heavy processing.

### Tech Stack
- **Frontend:** HTML5, CSS3, JavaScript (ES6+), Bootstrap 5.3
- **Backend:** Node.js, Express.js, Socket.IO
- **Database:** Cloud Firestore (primary direction for app data); NeDB/MongoDB may still appear for legacy/local paths
- **Authentication:** Firebase Auth
- **External APIs:** Google Maps, Twilio (SMS), Nodemailer (Email)

---

## 📁 Core Server Files

### `server.js` - Main Application Server
**Purpose:** Entry point that sets up Express server with Socket.IO for real-time communication.

**Key Responsibilities:**
- Configures middleware (CORS, Helmet, Compression, Rate Limiting)
- Mounts API routes for emergency, tracking, safety, and users
- Manages Socket.IO connections for live tracking
- Handles real-time events: location updates, emergency alerts, check-ins
- Provides health check endpoint at `/api/health`
- Graceful shutdown handling

**Socket.IO Events:**
- `joinSession` - Join tracking session room
- `locationUpdate` - Broadcast location to viewers
- `emergency` - Trigger emergency alert
- `checkIn` - Send safety check-in
- `endSession` - End tracking session

---

## 🔐 Authentication System

### `firebase-config.js`
Initializes Firebase with project credentials from environment variables.

### `firebase-auth.js` - Authentication Service
**Features:**
- Email/Password login and registration
- Social authentication (Google, Facebook, Apple)
- Phone number authentication with OTP
- Password reset functionality
- Auto-syncs user data to localStorage
- Auth state listener for UI updates

### `auth.html` - Login/Signup Interface
Beautiful tabbed interface with:
- Login, Sign Up, and Password Recovery forms
- Social login buttons with gradient animations
- Form validation and modal notifications

---

## 🗺️ Main Application Pages

### `index.html` - Landing Page
Marketing page with hero section, features, statistics, testimonials, and contact form.

### `dashboard.html` - User Control Center
**Features:**
- **Share Location:** Copies Google Maps link to clipboard
- **Emergency Alert:** Sends SOS with location to saved contacts
- **Statistics Cards:** Safe trips, zones, community members
- **Interactive Safety Map:** Day/night mode toggle
- **Recent Alerts:** Community safety notifications
- **Emergency Contacts Modal:** Add/remove trusted contacts (stored in localStorage)
- **Report Issue:** Floating button for incident reporting

### `live-tracker.html` - Real-Time Tracking
**Workflow:**
1. User fills travel details (name, destination, transport, contacts, PIN)
2. System starts GPS tracking and Socket.IO connection
3. Location updates broadcast every 5 seconds
4. Safety verification every 2 minutes (configurable via VERIFY_INTERVAL)
5. User has 20 seconds to enter PIN (configurable via PIN_TIMEOUT)
6. Auto-triggers emergency if no response
7. Session persists in localStorage (survives refresh)

### `safety-map.html` - Community Safety Visualization
Interactive map with heatmap overlay, incident markers, safe route calculation, and real-time reporting.

### `community.html` - Social Forum
Discussion platform for sharing safety tips and experiences.

---

## ⚙️ Backend API Routes

### `routes/liveTracker.js`
**Endpoints:**
- `POST /start` - Create tracking session with unique code
- `POST /update-location` - Store location updates
- `POST /verify-pin` - Validate safety check-in
- `POST /trigger-alert` - Send emergency email (during tracking)
- `POST /dashboard-alert` - Send SOS from dashboard
- `POST /stop` - End tracking session

**Email Templates:** Rich HTML emails with location maps and trip details.

### `routes/emergency.js`
Handles SOS alerts, emergency contact management, SMS/WhatsApp notifications.

### `routes/safety.js`
**Endpoints:**
- `GET /heatmap` - Safety heatmap data
- `POST /route` - Calculate safest route
- `POST /report` - Submit incident report
- `GET /incidents` - Retrieve incident data

### `routes/tracking.js`
General tracking session management and location history.

### `routes/users.js`
User profile management, registration, and preferences.

---

## 🗄️ Database Layer

### `config/database.js` - MongoDB Connection
Mongoose-based connection to MongoDB (production).

### `config/nedb.js` - Local Database
Lightweight embedded database for development/testing.

### `config/localDB.js` - JSON File Storage
Fallback JSON-based storage system.

---

## 📊 Data Models

### `models/User.js`
Fields: name, email, phone, emergencyContacts[], preferences, timestamps

### `models/TrackingSession.js`
Fields: userId, trackingCode, source, destination, transportMode, PIN, locationLogs[], isTrackingActive, timestamps

### `models/IncidentReport.js`
Fields: type, location (coordinates), description, severity, reporter, timestamps

---

## 🛠️ Services

### `services/smsService.js`
Twilio-based SMS notifications with mock mode fallback.

### `services/whatsappService.js`
WhatsApp messaging via Twilio API.

### `services/safetyAnalytics.js`
**Functions:**
- Calculate safety scores for areas
- Generate heatmap data
- Identify high-risk zones
- Route safety ratings
- Time-based analysis (day vs night)

---

## 🎨 Frontend JavaScript

### `navigation.js` - Unified Navigation System
**Responsibilities:**
- Injects responsive sidebar on all protected pages
- Manages authentication state and redirects
- Emergency contacts modal (add/remove/display)
- Auto-prompts for contacts if none exist on dashboard
- Mobile menu handling

### `live-tracker.js` - Live Tracking Client
**Key Components:**
- SafetyTracker class managing entire tracking lifecycle
- Google Maps integration with real-time marker updates
- Socket.IO connection for location broadcasting
- Periodic safety verification system (PIN modal)
- Emergency SOS with confirmation
- Session persistence using localStorage
- Auto-restore on page refresh

### `animations.js`
UI enhancements: cursor effects, scroll animations, card hovers.

### `styles.css`
Global styles with CSS variables, glassmorphism effects, gradients, responsive design.

---

## 🔧 Configuration

### `.env` - Environment Variables
```
PORT=3001
MONGODB_URI=your_mongodb_connection
FIREBASE_API_KEY=your_firebase_key
TWILIO_ACCOUNT_SID=your_twilio_sid
EMAIL_USER=your_gmail
EMAIL_PASS=your_app_password
VERIFY_INTERVAL=120000  # 2 minutes
PIN_TIMEOUT=20000       # 20 seconds
```

### `package.json`
Key dependencies: express, socket.io, firebase, nodemailer, mongoose, nedb-promises, helmet, twilio

---

## 🔄 Complete User Flow Example

### Emergency Alert from Dashboard:
1. User clicks "Emergency Alert" button
2. Confirmation modal appears
3. User confirms → Browser requests GPS location
4. Fetches emergency contacts from localStorage
5. Sends POST to `/api/live-tracker/dashboard-alert` with location + contacts
6. Server sends HTML email to all contacts via Nodemailer
7. Success notification shown to user

### Live Tracking Session:
1. User fills form in `live-tracker.html`
2. `live-tracker.js` validates and sends POST to `/api/live-tracker/start`
3. Server creates session in NeDB, returns sessionId
4. Client connects to Socket.IO, joins session room
5. GPS tracking starts (every 5 seconds):
   - Gets coordinates → Emits `locationUpdate` event
   - Server broadcasts to all viewers in room
6. Safety verification (every 2 minutes):
   - Modal appears with PIN input
   - 20-second countdown starts
   - If verified: continues tracking
   - If timeout: auto-triggers emergency alert
7. SOS button: Immediate emergency with confirmation modal
8. End tracking: Requires PIN verification

---

## 📊 Data Flow Architecture

```
Client (Browser)
    ↓ HTTP/HTTPS
Express Server (server.js)
    ↓
Routes Layer (emergency.js, tracking.js, etc.)
    ↓
Services Layer (smsService.js, safetyAnalytics.js)
    ↓
Database Layer (NeDB/MongoDB)

Parallel:
Client ↔ Socket.IO ↔ Server (Real-time events)
```

---

## 🚀 Deployment Notes

- **Development:** Uses NeDB for local database
- **Production:** Switch to MongoDB by uncommenting `connectDB()` in server.js
- **Firebase Hosting:** Configured via `firebase.json`
- **Environment:** Set `NODE_ENV=production` for production mode

---

## 🔒 Security Features

- Helmet.js for HTTP header security
- CORS configuration for API protection
- Rate limiting (100 requests per 15 minutes)
- Firebase Authentication with secure tokens
- PIN verification for sensitive operations
- Environment variables for secrets

---

## 📱 Responsive Design

- Mobile-first approach
- Collapsible sidebar navigation
- Touch-friendly buttons
- Adaptive layouts for all screen sizes
- Fixed action buttons on mobile

---

## 🎯 Key Features Summary

1. **Real-Time Tracking:** Live GPS updates via Socket.IO
2. **Emergency SOS:** One-click alerts to contacts
3. **Safety Verification:** Periodic check-ins with auto-alert
4. **Community Mapping:** Crowdsourced safety data
5. **Predictive Analytics:** AI-powered route safety
6. **Multi-Channel Alerts:** Email, SMS, WhatsApp
7. **Session Persistence:** Survives page refresh
8. **Contact Management:** Easy add/remove trusted contacts

---

## 📞 Support & Maintenance

- **Logs:** Morgan logger for HTTP requests
- **Health Check:** `/api/health` endpoint
- **Error Handling:** Centralized error middleware
- **Graceful Shutdown:** SIGTERM/SIGINT handlers

---

*Last Updated: January 2026*
*Version: 2.0.0*
