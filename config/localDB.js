const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../data/local_db.json');
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure DB file exists
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ sessions: [] }, null, 2));
}

class LocalDB {
    constructor() {
        this.dbPath = DB_FILE;
    }

    read() {
        try {
            const data = fs.readFileSync(this.dbPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error reading local DB:', error);
            return { sessions: [] };
        }
    }

    write(data) {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error writing to local DB:', error);
            return false;
        }
    }

    // Session Methods
    createSession(sessionData) {
        const db = this.read();
        db.sessions.push(sessionData);
        this.write(db);
        return sessionData;
    }

    getSession(userId) {
        const db = this.read();
        return db.sessions.find(s => s.userId === userId);
    }

    updateSession(userId, updates) {
        const db = this.read();
        const index = db.sessions.findIndex(s => s.userId === userId);
        if (index !== -1) {
            db.sessions[index] = { ...db.sessions[index], ...updates };
            this.write(db);
            return db.sessions[index];
        }
        return null;
    }

    addLocationLog(userId, location) {
        const db = this.read();
        const session = db.sessions.find(s => s.userId === userId);
        if (session) {
            if (!session.locationLogs) session.locationLogs = [];
            session.locationLogs.push(location);
            this.write(db);
            return session;
        }
        return null;
    }
}

module.exports = new LocalDB();
