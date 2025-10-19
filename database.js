const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class TrainDatabase {
  constructor(logger = null) {
    this.logger = logger;
    // Decide on a writable data directory with persistence when available
    // Priority: explicit DATA_DIR env → Fly volume mount at /data → local ./data
    let dataDir = process.env.DATA_DIR && process.env.DATA_DIR.trim()
      ? process.env.DATA_DIR.trim()
      : (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));

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
        service_date DATE NOT NULL,
        day_of_week TEXT,
        departure_time TEXT NOT NULL,
        std TEXT,
        etd TEXT,
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

    // Backfill schema for older databases that may not have new columns
    // SQLite does not support IF NOT EXISTS on ADD COLUMN, so ignore errors if column exists
    const tryAddColumn = (sql) => {
      try {
        this.db.exec(sql);
      } catch (e) {
        // ignore
      }
    };
    tryAddColumn("ALTER TABLE train_departures ADD COLUMN std TEXT");
    tryAddColumn("ALTER TABLE train_departures ADD COLUMN etd TEXT");

    // Create indexes for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_departure_time 
      ON train_departures(departure_time)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_service_date_time
      ON train_departures(service_date, departure_time)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_service_identity
      ON train_departures(service_date, destination, std)
    `);

    console.log('Database initialized successfully');
  }

  // Append-only store of a train departure snapshot
  // Identifies a logical service by (service_date, std, destination)
  // Inserts a new row only when any tracked field changes; otherwise skips
  storeDeparture(departureData) {
    const { std, etd, departure_time, platform, destination, operator, is_cancelled, delay_reason } = departureData;

    // Derive service_date and day_of_week if not provided
    let { service_date, day_of_week } = departureData;
    const now = new Date();
    if (!service_date) {
      // Use UK local time to handle BST correctly
      service_date = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'); // YYYY-MM-DD
    }
    if (!day_of_week) {
      day_of_week = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
    }

    // Convert boolean to integer for SQLite
    const isCancelledInt = is_cancelled ? 1 : 0;

    // Determine grouping key using scheduled time (std) to represent the logical service
    const scheduledTime = std || departure_time; // fallback for legacy callers

    // Fetch the most recent snapshot for this logical service
    const latest = this.db.prepare(`
      SELECT * FROM train_departures
      WHERE service_date = ? AND destination = ? AND std = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(service_date, destination, scheduledTime);

    // If we have a recent record (within last 5 minutes), be more strict about changes
    const currentTime = new Date();
    const fiveMinutesAgo = new Date(currentTime.getTime() - 5 * 60 * 1000);
    const isRecent = latest && new Date(latest.created_at) > fiveMinutesAgo;

    // Normalize fields for comparison
    const latestComparable = latest || {};
    const nextEtd = etd || null;
    const nextDepartureTime = nextEtd || scheduledTime;

    // Normalize null/undefined values for proper comparison
    const normalizeValue = (val) => val === null || val === undefined ? null : val;

    const hasChange = !latest || (
      normalizeValue(latestComparable.platform) !== normalizeValue(platform) ||
      normalizeValue(latestComparable.operator) !== normalizeValue(operator) ||
      Number(latestComparable.is_cancelled) !== isCancelledInt ||
      normalizeValue(latestComparable.delay_reason) !== normalizeValue(delay_reason) ||
      normalizeValue(latestComparable.etd) !== normalizeValue(nextEtd) ||
      normalizeValue(latestComparable.departure_time) !== normalizeValue(nextDepartureTime)
    );

    if (!hasChange) {
      return;
    }

    // Insert new snapshot row (append-only)
    const insert = this.db.prepare(`
      INSERT INTO train_departures (
        service_date, day_of_week, departure_time, std, etd, platform, destination, operator, is_cancelled, delay_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      service_date,
      day_of_week,
      nextDepartureTime,
      scheduledTime,
      nextEtd,
      platform,
      destination,
      operator,
      isCancelledInt,
      delay_reason
    );
    const ukTime = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
    const logMessage = `[${ukTime}] Stored new snapshot for ${service_date} ${scheduledTime} (${nextDepartureTime}) to ${destination}`;
    if (this.logger) {
      this.logger.log(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  // Get recent departures
  getRecentDepartures(limit = null) {
    if (limit) {
      const stmt = this.db.prepare(`
        SELECT * FROM train_departures 
        ORDER BY created_at DESC 
        LIMIT ?
      `);
      return stmt.all(limit);
    } else {
      const stmt = this.db.prepare(`
        SELECT * FROM train_departures 
        ORDER BY created_at DESC
      `);
      return stmt.all();
    }
  }



  // Get all records for a given service (identified by day_of_week, std, and destination)
  getServiceRecords(dayOfWeek, std, destination) {
    const stmt = this.db.prepare(`
      SELECT * FROM train_departures
      WHERE day_of_week = ? AND std = ? AND destination = ?
      ORDER BY service_date DESC, created_at DESC
    `);
    return stmt.all(dayOfWeek, std, destination);
  }

  // Get the last known non-null platform for a service on today's date
  getLastKnownPlatform(serviceDate, std, destination) {
    const stmt = this.db.prepare(`
      SELECT platform FROM train_departures
      WHERE service_date = ? AND std = ? AND destination = ? AND platform IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const result = stmt.get(serviceDate, std, destination);
    return result ? result.platform : null;
  }

  // Get platform counts for a given service (identified by day_of_week, std, and destination)
  // Excludes today's data to show only historical patterns
  getServicePlatformCounts(dayOfWeek, std, destination) {
    // Use UK local time to handle BST correctly
    const now = new Date();
    const today = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'); // YYYY-MM-DD format

    // First, get the most recent record per service_date for the given service
    // that has a non-null platform, excluding today's data
    const stmt = this.db.prepare(`
      WITH latest_records AS (
        SELECT service_date, day_of_week, std, platform, destination,
               ROW_NUMBER() OVER (
                 PARTITION BY service_date 
                 ORDER BY created_at DESC
               ) as rn
        FROM train_departures
        WHERE day_of_week = ? AND std = ? AND destination = ? AND platform IS NOT NULL AND service_date != ?
      )
      SELECT platform, COUNT(*) as count
      FROM latest_records
      WHERE rn = 1
      GROUP BY platform
      ORDER BY platform
    `);

    const results = stmt.all(dayOfWeek, std, destination, today);
    return results;
  }

  // Get all unique services from the database
  getUniqueServices() {
    const stmt = this.db.prepare(`
      SELECT DISTINCT 
        day_of_week,
        COALESCE(std, departure_time) as scheduled_time,
        std,
        departure_time,
        destination,
        COUNT(*) as total_records,
        MIN(service_date) as first_seen,
        MAX(service_date) as last_seen,
        MIN(created_at) as first_captured,
        MAX(created_at) as last_captured
      FROM train_departures
      GROUP BY day_of_week, COALESCE(std, departure_time), destination
      ORDER BY day_of_week, scheduled_time, destination
    `);

    const results = stmt.all();

    // Convert to more readable format
    return results.map(row => ({
      dayOfWeek: row.day_of_week,
      scheduledTime: row.scheduled_time,
      destination: row.destination,
      totalRecords: row.total_records,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      firstCaptured: row.first_captured,
      lastCaptured: row.last_captured,
      // Include both std and departure_time for reference
      std: row.std,
      departureTime: row.departure_time
    }));
  }

  // Get platform counts for all services
  // Excludes today's data to show only historical patterns
  getAllServicesPlatformCounts() {
    // Use UK local time to handle BST correctly
    const now = new Date();
    const today = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'); // YYYY-MM-DD format

    // Get the most recent record per service_date for each service
    // that has a non-null platform, grouped by service (day_of_week + scheduled_time + destination)
    // Use std if available, otherwise fall back to departure_time
    const stmt = this.db.prepare(`
      WITH latest_records AS (
        SELECT service_date, day_of_week, 
               COALESCE(std, departure_time) as scheduled_time,
               std, departure_time, platform, destination,
               ROW_NUMBER() OVER (
                 PARTITION BY service_date, day_of_week, COALESCE(std, departure_time), destination
                 ORDER BY created_at DESC
               ) as rn
        FROM train_departures
        WHERE platform IS NOT NULL AND service_date != ?
      ),
      service_platforms AS (
        SELECT day_of_week, scheduled_time, std, departure_time, platform, destination, COUNT(*) as count
        FROM latest_records
        WHERE rn = 1
        GROUP BY day_of_week, scheduled_time, std, departure_time, platform, destination
      )
      SELECT day_of_week, scheduled_time, std, departure_time, destination, platform, count
      FROM service_platforms
      ORDER BY day_of_week, scheduled_time, platform
    `);

    const results = stmt.all(today);

    // Group results by service (day_of_week + scheduled_time + destination)
    const services = {};
    results.forEach(row => {
      const serviceKey = `${row.day_of_week}_${row.scheduled_time}_${row.destination}`;
      if (!services[serviceKey]) {
        services[serviceKey] = {
          dayOfWeek: row.day_of_week,
          scheduledTime: row.scheduled_time,
          destination: row.destination,
          platformCounts: [],
          totalDays: 0
        };
      }
      services[serviceKey].platformCounts.push({
        platform: row.platform,
        count: row.count
      });
      services[serviceKey].totalDays += row.count;
    });

    // Convert to array and sort
    return Object.values(services).sort((a, b) => {
      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const aDayIndex = dayOrder.indexOf(a.dayOfWeek);
      const bDayIndex = dayOrder.indexOf(b.dayOfWeek);

      if (aDayIndex !== bDayIndex) {
        return aDayIndex - bDayIndex;
      }

      // If same day, sort by time
      return a.scheduledTime.localeCompare(b.scheduledTime);
    });
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
