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
- **Platform analysis**: Advanced platform distribution analysis across services

## Platform Analysis Features

The database includes sophisticated platform analysis capabilities that help understand platform usage patterns:

### Service Identification
- Services are identified by `(day_of_week, scheduled_time, destination)`
- Uses `std` (scheduled time) as the primary service identifier
- Falls back to `departure_time` for legacy data without `std`

### Platform Distribution Analysis
- **Per-service analysis**: Get platform counts for specific services
- **Comprehensive analysis**: Analyze platform usage across all services
- **Historical accuracy**: Uses the most recent record per service date to avoid duplicate counting
- **Change tracking**: Platform changes are captured as new snapshots, preserving historical data

### Data Quality
- Only includes records with non-null platform information
- Filters out incomplete or invalid platform data
- Provides total day counts for statistical confidence

## API Endpoints

### Core Endpoints
- `GET /api/next-train/:from/:to` - Get next train (now also stores data in database)
- `GET /api/health` - Health check endpoint

### Database Query Endpoints
- `GET /api/departures?limit=10` - Get recent departures from database (returns all if no limit specified)

### Platform Analysis Endpoints
- `GET /api/platforms/:dayOfWeek/:std` - Get platform counts for a specific service
  - Parameters: `dayOfWeek` (Monday-Sunday), `std` (HH:MM format)
  - Returns platform distribution for the specified service
- `GET /api/all-platforms` - Get platform counts for all services
  - Returns comprehensive platform analysis across all services

## Usage

### Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run all tests:
   ```bash
   npm test
   ```

3. Or run individual tests:
   ```bash
   # Test database functionality
   npm run test-database
   
   # Test API endpoints (requires server running)
   npm run test-api
   
   # Test platform analysis endpoints
   npm run test-platforms
   
   # Test URL endpoints
   npm run test-urls
   ```

4. Start the server:
   ```bash
   npm start
   ```

### Docker Usage

1. Build and run with Docker Compose:
   ```bash
   docker-compose up --build
   ```

2. Test the application inside Docker:
   ```bash
   # Run all tests
   docker compose exec -T train-app npm test
   
   # Or run individual tests
   docker compose exec -T train-app npm run test-database
   docker compose exec -T train-app npm run test-api
   docker compose exec -T train-app npm run test-platforms
   docker compose exec -T train-app npm run test-urls
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

### Platform analysis queries
```bash
# Get platform counts for a specific service (Monday 08:30)
curl http://localhost:3000/api/platforms/Monday/08:30

# Get platform counts for Friday evening service
curl http://localhost:3000/api/platforms/Friday/17:15

# Get comprehensive platform analysis for all services
curl http://localhost:3000/api/all-platforms
```

### Health check
```bash
# Check server status
curl http://localhost:3000/api/health
```

## Database Class Methods

The `TrainDatabase` class provides the following methods:

### Core Methods
- `storeDeparture(departureData)` - Append-only store with change detection
- `getRecentDepartures(limit)` - Get recent departures
- `cleanupOldRecords()` - Remove records older than 3 months
- `close()` - Close database connection

### Platform Analysis Methods
- `getServicePlatformCounts(dayOfWeek, std)` - Get platform distribution for a specific service
  - Returns platform counts for the specified day of week and scheduled time
  - Uses the most recent record per service date for accurate analysis
- `getAllServicesPlatformCounts()` - Get platform analysis for all services
  - Returns comprehensive platform data across all services
  - Groups by service (day of week + scheduled time + destination)
  - Includes total days and platform distribution for each service

## Indexes

- `idx_departure_time(departure_time)`
- `idx_service_date_time(service_date, departure_time)`
- `idx_service_identity(service_date, destination, std)`
