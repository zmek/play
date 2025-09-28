# Train Database Implementation

This document describes the database implementation for storing train departure platform data.

## Overview

The application uses SQLite with `better-sqlite3` to store train departure information, including platform data, in a local database file.

## Database Schema

```sql
CREATE TABLE train_departures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_date DATE NOT NULL,
  day_of_week TEXT,
  departure_time TEXT NOT NULL, -- current display time (etd if present, else std)
  std TEXT,                     -- scheduled time (service identity)
  etd TEXT,                     -- estimated time (nullable)
  platform TEXT,
  destination TEXT NOT NULL,
  operator TEXT,
  is_cancelled BOOLEAN DEFAULT 0,
  delay_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Features

- **Automatic data storage**: All train departures are automatically stored when fetched from the API
- **Append-only snapshots**: The database never updates rows. Each change in any tracked field (platform, operator, is_cancelled, delay_reason, etd, or effective departure_time) inserts a new row snapshot.
- **Service identity**: A logical service is identified by `(service_date, destination, std)`. The latest snapshot is the one with the greatest `created_at`.
- **Platform tracking**: Platform information is captured and preserved across changes
- **Data persistence**: Database file is persisted in Docker volumes
- **Automatic cleanup**: Old records (3+ months) are automatically cleaned up
- **Query endpoints**: RESTful API endpoints for retrieving stored data

## API Endpoints

### Existing Endpoints
- `GET /api/next-train/:from/:to` - Get next train (now also stores data in database)

### New Database Endpoints
- `GET /api/departures?limit=10` - Get recent departures from database (returns all if no limit specified)

## Usage

### Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Test the database:
   ```bash
   node test-database.js
   ```

3. Start the server:
   ```bash
   npm start
   ```

### Docker Usage

1. Build and run with Docker Compose:
   ```bash
   docker-compose up --build
   ```

The database file will be persisted in the `./data` directory.

## Database File Location

- **Local development**: `./data/train_departures.db`
- **Docker**: Mounted as volume in `./data` directory

## Data Management

- **Automatic storage**: Data is stored every time the API is called
- **Append-only**: Existing records are never updated. Changes result in inserted snapshots; no overwrites.
- **Cleanup**: Records older than 3 months are automatically removed
- **Backup**: Simply copy the `train_departures.db` file to backup your data

## Example Queries

### Get recent departures
```bash
# Get all recent departures
curl http://localhost:3000/api/departures

# Get limited number of recent departures
curl http://localhost:3000/api/departures?limit=5
```

## Database Class Methods

The `TrainDatabase` class provides the following methods:

- `storeDeparture(departureData)` - Append-only store with change detection
- `getRecentDepartures(limit)` - Get recent departures
- `cleanupOldRecords()` - Remove records older than 3 months
- `close()` - Close database connection

## Indexes

- `idx_departure_time(departure_time)`
- `idx_service_date_time(service_date, departure_time)`
- `idx_service_identity(service_date, destination, std)`
