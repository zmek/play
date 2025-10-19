const fs = require('fs');
const path = require('path');

class SimpleLogger {
    constructor() {
        // Use the same data directory logic as the database
        let dataDir = process.env.DATA_DIR && process.env.DATA_DIR.trim()
            ? process.env.DATA_DIR.trim()
            : (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.logFile = path.join(dataDir, 'poller.log');
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;

        // Write to console (existing behavior)
        console.log(message);

        // Write to file
        fs.appendFileSync(this.logFile, logEntry);
    }

    error(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ERROR: ${message}\n`;

        // Write to console (existing behavior)
        console.error(message);

        // Write to file
        fs.appendFileSync(this.logFile, logEntry);
    }
}

module.exports = SimpleLogger;
