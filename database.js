const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class TrainDatabase {
  constructor() {
    // Create database file in the data directory (for Docker persistence)
    const dataDir = path.join(__dirname, 'data');

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, 'train_departures.db');
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    // Create the train_departures table if it doesn't exist
    const createTable = `
      CREATE TABLE IF NOT EXISTS train_departures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        departure_time TEXT NOT NULL,
        platform TEXT,
        destination TEXT NOT NULL,
        operator TEXT,
        is_cancelled BOOLEAN DEFAULT 0,
        delay_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    this.db.exec(createTable);

    // Create index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_departure_time 
      ON train_departures(departure_time)
    `);

    console.log('Database initialized successfully');
  }

  // Store or update a train departure
  storeDeparture(departureData) {
    const { departure_time, platform, destination, operator, is_cancelled, delay_reason } = departureData;

    // Convert boolean to integer for SQLite
    const isCancelledInt = is_cancelled ? 1 : 0;

    // Check if a record already exists for this departure time and destination
    const existing = this.db.prepare(`
      SELECT id FROM train_departures 
      WHERE departure_time = ? AND destination = ?
    `).get(departure_time, destination);

    if (existing) {
      // Update existing record
      const update = this.db.prepare(`
        UPDATE train_departures 
        SET platform = ?, operator = ?, is_cancelled = ?, delay_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      update.run(platform, operator, isCancelledInt, delay_reason, existing.id);
      console.log(`Updated departure record for ${departure_time} to ${destination}`);
    } else {
      // Insert new record
      const insert = this.db.prepare(`
        INSERT INTO train_departures (departure_time, platform, destination, operator, is_cancelled, delay_reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run(departure_time, platform, destination, operator, isCancelledInt, delay_reason);
      console.log(`Stored new departure record for ${departure_time} to ${destination}`);
    }
  }

  // Get recent departures
  getRecentDepartures(limit = 10) {
    const stmt = this.db.prepare(`
      SELECT * FROM train_departures 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  // Get departures by platform
  getDeparturesByPlatform(platform) {
    const stmt = this.db.prepare(`
      SELECT * FROM train_departures 
      WHERE platform = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(platform);
  }

  // Get platform statistics
  getPlatformStats() {
    const stmt = this.db.prepare(`
      SELECT 
        platform,
        COUNT(*) as count,
        COUNT(CASE WHEN is_cancelled = 0 THEN 1 END) as on_time_count,
        COUNT(CASE WHEN is_cancelled = 1 THEN 1 END) as cancelled_count
      FROM train_departures 
      WHERE platform IS NOT NULL
      GROUP BY platform
      ORDER BY count DESC
    `);
    return stmt.all();
  }

  // Clean up old records (keep last 3 months)
  cleanupOldRecords() {
    const stmt = this.db.prepare(`
      DELETE FROM train_departures 
      WHERE created_at < datetime('now', '-3 months')
    `);
    const result = stmt.run();
    console.log(`Cleaned up ${result.changes} old records`);
    return result.changes;
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

module.exports = TrainDatabase;
