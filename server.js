const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const TrainDatabase = require('./database');

const app = express();
const PORT = 3000;

// Initialize database
const trainDB = new TrainDatabase();

// Enable CORS for all routes
app.use(cors());

// Serve static files (your HTML page)
app.use(express.static('public'));

// LDBWS API configuration
// Get values from environment variables with fallbacks
const LDBWS_BASE_URL = process.env.LDBWS_BASE_URL || 'http://localhost';
const LDBWS_API_KEY = process.env.LDBWS_API_KEY || 'your-api-key-here';

// API endpoint to get next train
app.get('/api/next-train/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;

    // Make request to LDBWS API
    const apiUrl = `${LDBWS_BASE_URL}/LDBWS/api/20220120/GetDepartureBoard/${from}?numRows=10&filterCrs=${to}&filterType=to&timeOffset=0&timeWindow=120`;

    console.log(`Fetching: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      headers: {
        'x-apikey': LDBWS_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();

    // Store platform data in database if we have departure information
    if (data.departures && data.departures.length > 0) {
      data.departures.forEach(departure => {
        if (departure.service) {
          trainDB.storeDeparture({
            departure_time: departure.service.etd && departure.service.etd !== 'On time' ? departure.service.etd : departure.service.std,
            platform: departure.service.platform,
            destination: departure.crs || 'Unknown',
            operator: departure.service.operator,
            is_cancelled: departure.service.isCancelled || false,
            delay_reason: departure.service.delayReason
          });
        }
      });
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching train data:', error);

    // Return mock data for development and store it in database
    const mockData = {
      departures: [{
        service: {
          std: "14:45",
          etd: "On time",
          operator: "Great Western Railway",
          platform: "4",
          isCancelled: false,
          delayReason: null
        },
        crs: "TLH"
      }],
      locationName: "London Paddington",
      generatedAt: new Date().toISOString(),
      mockData: true
    };

    // Store mock data in database
    mockData.departures.forEach(departure => {
      if (departure.service) {
        trainDB.storeDeparture({
          departure_time: departure.service.etd && departure.service.etd !== 'On time' ? departure.service.etd : departure.service.std,
          platform: departure.service.platform,
          destination: departure.crs || 'Unknown',
          operator: departure.service.operator,
          is_cancelled: departure.service.isCancelled || false,
          delay_reason: departure.service.delayReason
        });
      }
    });

    res.json(mockData);
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Get recent departures from database
app.get('/api/departures/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const departures = trainDB.getRecentDepartures(limit);
    res.json({ departures, count: departures.length });
  } catch (error) {
    console.error('Error fetching recent departures:', error);
    res.status(500).json({ error: 'Failed to fetch recent departures' });
  }
});

// Get departures by platform
app.get('/api/departures/platform/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    const departures = trainDB.getDeparturesByPlatform(platform);
    res.json({ platform, departures, count: departures.length });
  } catch (error) {
    console.error('Error fetching departures by platform:', error);
    res.status(500).json({ error: 'Failed to fetch departures by platform' });
  }
});

// Get platform statistics
app.get('/api/platforms/stats', (req, res) => {
  try {
    const stats = trainDB.getPlatformStats();
    res.json({ platformStats: stats });
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({ error: 'Failed to fetch platform statistics' });
  }
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api/next-train/PAD/TLH`);
  console.log(`Database endpoints:`);
  console.log(`  - Recent departures: http://localhost:${PORT}/api/departures/recent`);
  console.log(`  - Platform stats: http://localhost:${PORT}/api/platforms/stats`);
  console.log(`  - Departures by platform: http://localhost:${PORT}/api/departures/platform/4`);
});

// Clean up old records every 12 hours
setInterval(() => {
  trainDB.cleanupOldRecords();
}, 12 * 60 * 60 * 1000); // 12 hours

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  trainDB.close();
  process.exit(0);
});
