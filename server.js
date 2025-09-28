const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const TrainDatabase = require('./database');

// Initialize Express application. app refers to the Express application object.
const app = express();
const PORT = 3000;

// Initialize database
const trainDB = new TrainDatabase();

// Enable CORS for all routes to allow the frontend (which may be served from a different origin or port) 
// to make API requests to this backend server. This is necessary for local development and for deployment 
// scenarios where the frontend and backend are hosted separately.
app.use(cors());

// Serve static files (your HTML page) to the frontend. This is necessary for local development and for deployment 
// scenarios where the frontend and backend are hosted separately.
app.use(express.static('public'));

// LDBWS API configuration
// Get values from environment variables with fallbacks to default values if not set.
const LDBWS_BASE_URL = process.env.LDBWS_BASE_URL || 'http://localhost';
const LDBWS_API_KEY = process.env.LDBWS_API_KEY || 'your-api-key-here';
const NEXTDEPS_BASE_URL = process.env.NEXTDEPS_BASE_URL || 'http://localhost';
const NEXTDEPS_API_KEY = process.env.NEXTDEPS_API_KEY || 'your-api-key-here';

// Poller configuration (env-gated)
const FROM_CRS = process.env.FROM_CRS || 'PAD';
const TO_CRS = process.env.TO_CRS || 'TLH';
const POLL_MS = parseInt(process.env.POLL_MS || '60000', 10);
const ENABLE_POLLER = (process.env.ENABLE_POLLER || '').toLowerCase() === 'true' || process.env.ENABLE_POLLER === '1';

// Helper to fetch next departure and store snapshot
async function fetchAndStoreNextDeparture(from, to) {
  const apiUrl = `${NEXTDEPS_BASE_URL}/LDBWS/api/20220120/GetNextDepartures/${from}/${to}?timeOffset=0&timeWindow=120`;
  console.log(`Fetching: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      'x-apikey': NEXTDEPS_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`API responded with status: ${response.status}`);
  }

  const data = await response.json();
  const departure = data.departure || data.departures?.[0] || null;

  if (departure && departure.service) {
    const svc = departure.service;
    const now = new Date();
    const service_date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const day_of_week = now.toLocaleDateString('en-GB', { weekday: 'long' });
    trainDB.storeDeparture({
      service_date,
      day_of_week,
      std: svc.std,
      etd: svc.etd && svc.etd !== 'On time' ? svc.etd : null,
      departure_time: svc.etd && svc.etd !== 'On time' ? svc.etd : svc.std,
      platform: svc.platform,
      destination: departure.crs || 'Unknown',
      operator: svc.operator,
      is_cancelled: svc.isCancelled || false,
      delay_reason: svc.delayReason
    });
  }

  return {
    departure,
    locationName: data.locationName || from
  };
}

// API endpoint to get next train. This is the main endpoint that the frontend will call to get the next train information.
// In Express, 'req' is the request object representing the HTTP request, and 'res' is the response object used to send a response back to the client.
app.get('/api/next-train/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    const { departure, locationName } = await fetchAndStoreNextDeparture(from, to);
    res.json({
      departure,
      locationName,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching train data:', error);
    res.status(502).json({ error: 'Failed to fetch train data from upstream service' });
  }
});

// Health check endpoint to check if the server is running.
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Get recent departures from database.
app.get('/api/departures', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    // Get the recent departures from the database.
    const departures = trainDB.getRecentDepartures(limit);
    res.json({ departures, count: departures.length });
  } catch (error) {
    console.error('Error fetching recent departures:', error);
    res.status(500).json({ error: 'Failed to fetch recent departures' });
  }
});

// Serve the main HTML page.
// The '/' route serves the main HTML page for the frontend application.
// When a user visits the root URL, this handler sends 'public/index.html' as the response.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server. This is the main entry point for the Express application.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api/next-train/PAD/TLH`);
  console.log(`Database endpoints:`);
  console.log(`  - Recent departures: http://localhost:${PORT}/api/departures`);
  if (ENABLE_POLLER) {
    console.log(`Poller enabled. FROM=${FROM_CRS} TO=${TO_CRS} every ${POLL_MS}ms`);
    // Kick off immediately, then on interval
    fetchAndStoreNextDeparture(FROM_CRS, TO_CRS).catch(err => console.error('Poller initial fetch failed:', err));
    setInterval(() => {
      fetchAndStoreNextDeparture(FROM_CRS, TO_CRS).catch(err => console.error('Poller fetch failed:', err));
    }, POLL_MS);
  } else {
    console.log('Poller disabled. Set ENABLE_POLLER=true to enable.');
  }
});

// Clean up old records every 12 hours. This is a cron job that runs every 12 hours to remove old records from the database.
setInterval(() => {
  trainDB.cleanupOldRecords();
}, 12 * 60 * 60 * 1000); // 12 hours

// Graceful shutdown. This is a signal handler that runs when the server is shut down.
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  trainDB.close();
  process.exit(0);
});
