# Train Database Implementation

This document describes the database implementation for storing train departure platform data.

## Overview

The application uses SQLite with `better-sqlite3` to store train departure information, including platform data, in a local database file.

## Database Schema

```sql
CREATE TABLE train_departures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  departure_time TEXT NOT NULL,
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
- **Platform tracking**: Platform information is captured and stored for each departure
- **Data persistence**: Database file is persisted in Docker volumes
- **Automatic cleanup**: Old records (3+ months) are automatically cleaned up
- **Query endpoints**: RESTful API endpoints for retrieving stored data

## API Endpoints

### Existing Endpoints
- `GET /api/next-train/:from/:to` - Get next train (now also stores data in database)

### New Database Endpoints
- `GET /api/departures/recent?limit=10` - Get recent departures from database
- `GET /api/departures/platform/:platform` - Get departures by platform
- `GET /api/platforms/stats` - Get platform usage statistics

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
- **Update handling**: Existing records are updated if platform information changes
- **Cleanup**: Records older than 3 months are automatically removed
- **Backup**: Simply copy the `train_departures.db` file to backup your data

## Example Queries

### Get recent departures
```bash
curl http://localhost:3000/api/departures/recent?limit=5
```

## Database Class Methods

The `TrainDatabase` class provides the following methods:

- `storeDeparture(departureData)` - Store or update a departure record
- `getRecentDepartures(limit)` - Get recent departures
- `cleanupOldRecords()` - Remove records older than 3 months
- `close()` - Close database connection
