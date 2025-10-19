const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const TrainDatabase = require('./database');
const SimpleLogger = require('./logger');

// Initialize Express application. app refers to the Express application object.
const app = express();
const PORT = 3000;

// Initialize logger and database
const logger = new SimpleLogger();
const trainDB = new TrainDatabase(logger);

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
  const now = new Date();
  const ukTime = now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false });
  logger.log(`[${ukTime}] Fetching: ${apiUrl}`);

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
    // Use UK local time for both date and day to handle BST correctly
    const service_date = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'); // YYYY-MM-DD
    const day_of_week = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
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

    // If the current platform is null but we have service info, try to get the last known platform
    if (departure && departure.service && !departure.service.platform) {
      const now = new Date();
      const service_date = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
      const std = departure.service.std;
      const destination = departure.crs;

      const lastKnownPlatform = trainDB.getLastKnownPlatform(service_date, std, destination);

      if (lastKnownPlatform) {
        // Add the last known platform to the response
        departure.service.platform = lastKnownPlatform;
        departure.service.platformSource = 'last_known'; // Mark that this is a fallback
      }
    }

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

// Get all records for a specific service (identified by day of week, scheduled time, and destination)
app.get('/api/service/:dayOfWeek/:std/:destination?', (req, res) => {
  try {
    const { dayOfWeek, std } = req.params;
    const destination = req.params.destination || 'TLH';

    // Validate day of week
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (!validDays.includes(dayOfWeek)) {
      return res.status(400).json({
        error: 'Invalid day of week. Must be one of: ' + validDays.join(', ')
      });
    }

    // Validate std format (basic time format check)
    const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timePattern.test(std)) {
      return res.status(400).json({
        error: 'Invalid scheduled time format. Expected HH:MM format (e.g., 08:30)'
      });
    }

    const records = trainDB.getServiceRecords(dayOfWeek, std, destination);

    res.json({
      service: {
        dayOfWeek,
        scheduledTime: std,
        destination
      },
      records,
      totalRecords: records.length
    });
  } catch (error) {
    console.error('Error fetching service records:', error);
    res.status(500).json({ error: 'Failed to fetch service records' });
  }
});

// Get platform counts for a specific service (identified by day of week, scheduled time, and destination)
app.get('/api/platforms/:dayOfWeek/:std/:destination?', (req, res) => {
  try {
    const { dayOfWeek, std } = req.params;
    const destination = req.params.destination || 'TLH';

    // Validate day of week
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    if (!validDays.includes(dayOfWeek)) {
      return res.status(400).json({
        error: 'Invalid day of week. Must be one of: ' + validDays.join(', ')
      });
    }

    // Validate std format (basic time format check)
    const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timePattern.test(std)) {
      return res.status(400).json({
        error: 'Invalid scheduled time format. Expected HH:MM format (e.g., 08:30)'
      });
    }

    const platformCounts = trainDB.getServicePlatformCounts(dayOfWeek, std, destination);

    res.json({
      service: {
        dayOfWeek,
        scheduledTime: std,
        destination
      },
      platformCounts,
      totalDays: platformCounts.reduce((sum, item) => sum + item.count, 0)
    });
  } catch (error) {
    console.error('Error fetching service platform counts:', error);
    res.status(500).json({ error: 'Failed to fetch service platform counts' });
  }
});

// Get all unique services from the database
app.get('/api/services', (req, res) => {
  try {
    const uniqueServices = trainDB.getUniqueServices();

    res.json({
      services: uniqueServices,
      totalServices: uniqueServices.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching unique services:', error);
    res.status(500).json({ error: 'Failed to fetch unique services' });
  }
});

// Get platform counts for all services
app.get('/api/all-platforms', (req, res) => {
  try {
    const allServices = trainDB.getAllServicesPlatformCounts();

    res.json({
      services: allServices,
      totalServices: allServices.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching all service platform counts:', error);
    res.status(500).json({ error: 'Failed to fetch all service platform counts' });
  }
});

// Generate SVG chart for next departing service
app.get('/api/next-train-chart/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;

    // First get the next train to identify the service
    const { departure } = await fetchAndStoreNextDeparture(from, to);

    if (!departure || !departure.service) {
      return res.status(404).json({ error: 'No train found' });
    }

    const service = departure.service;
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
    const service_date = now.toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
    const std = service.std;
    const destination = departure.crs || 'Unknown';

    // Get platform counts for this service
    const platformCounts = trainDB.getServicePlatformCounts(dayOfWeek, std, destination);

    // Get current train's platform for the train icon
    // If platform is null, try to get the last known platform
    let currentPlatform = service.platform;
    if (!currentPlatform) {
      currentPlatform = trainDB.getLastKnownPlatform(service_date, std, destination);
    }

    // Generate SVG chart
    const svg = generatePlatformChart(platformCounts, dayOfWeek, std, currentPlatform);

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (error) {
    console.error('Error generating chart:', error);
    res.status(500).json({ error: 'Failed to generate chart' });
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
  console.log(`  - All unique services: http://localhost:${PORT}/api/services`);
  console.log(`  - Service records: http://localhost:${PORT}/api/service/Monday/08:30 (destination defaults to TLH)`);
  console.log(`  - Service platform counts: http://localhost:${PORT}/api/platforms/Monday/08:30 (destination defaults to TLH)`);
  console.log(`  - All services platform data: http://localhost:${PORT}/api/all-platforms`);
  console.log(`  - Next train chart: http://localhost:${PORT}/api/next-train-chart/PAD/TLH`);
  if (ENABLE_POLLER) {
    console.log(`Poller enabled. FROM=${FROM_CRS} TO=${TO_CRS} every ${POLL_MS}ms`);
    // Kick off immediately, then on interval
    fetchAndStoreNextDeparture(FROM_CRS, TO_CRS).catch(err => logger.error('Poller initial fetch failed: ' + err.message));
    setInterval(() => {
      fetchAndStoreNextDeparture(FROM_CRS, TO_CRS).catch(err => logger.error('Poller fetch failed: ' + err.message));
    }, POLL_MS);
  } else {
    console.log('Poller disabled. Set ENABLE_POLLER=true to enable.');
  }
});

// Clean up old records every 12 hours. This is a cron job that runs every 12 hours to remove old records from the database.
setInterval(() => {
  trainDB.cleanupOldRecords();
}, 12 * 60 * 60 * 1000); // 12 hours

// Generate SVG chart for platform distribution
function generatePlatformChart(platformCounts, dayOfWeek, std, currentPlatform = null) {
  // Create a map of platform counts for easy lookup
  const platformMap = {};
  platformCounts.forEach(item => {
    platformMap[item.platform] = item.count;
  });

  // Find the maximum count for scaling
  const maxCount = Math.max(...platformCounts.map(item => item.count), 1);

  // Chart dimensions - vertical layout
  const chartWidth = 800;
  const chartHeight = 300;
  const barWidth = 40;
  const barSpacing = 10;
  const leftMargin = 60;
  const rightMargin = 60;
  const topMargin = 60;
  const bottomMargin = 40;

  // Calculate available height for bars
  const availableHeight = chartHeight - topMargin - bottomMargin;

  // Generate bars for all 14 platforms
  let bars = '';
  let labels = '';
  let trainIcon = '';

  for (let platform = 1; platform <= 14; platform++) {
    const count = platformMap[platform] || 0;
    const barHeight = (count / maxCount) * availableHeight;
    const x = leftMargin + (platform - 1) * (barWidth + barSpacing);
    const isCurrentPlatform = currentPlatform && parseInt(currentPlatform) === platform;

    // Platform label - centered below the bar
    labels += `<text x="${x + barWidth / 2}" y="${chartHeight - 10}" text-anchor="middle" font-family="'Courier New', monospace" font-size="14" fill="#000">${platform}</text>`;

    // Bar background (light gray) - drawn from bottom up
    const barClass = isCurrentPlatform ? 'platform-bar has-train' : 'platform-bar';
    bars += `<rect x="${x}" y="${chartHeight - bottomMargin - availableHeight}" width="${barWidth}" height="${availableHeight}" fill="#f0f0f0" stroke="#ddd" stroke-width="1"/>`;

    // Bar fill (black) - drawn from bottom up
    bars += `<rect class="${barClass}" x="${x}" y="${chartHeight - bottomMargin - barHeight}" width="${barWidth}" height="${barHeight}" fill="#000"/>`;

    // Count label - centered above the bar
    bars += `<text x="${x + barWidth / 2}" y="${chartHeight - bottomMargin - barHeight - 5}" text-anchor="middle" font-family="'Courier New', monospace" font-size="12" fill="#666">${count}</text>`;

    // Add train icon if this is the current platform
    if (isCurrentPlatform) {
      const trainX = x + barWidth / 2;
      const trainY = chartHeight - bottomMargin - barHeight - 25;

      trainIcon += `
        <g class="train-icon">
          <!-- Train head -->
          <rect class="train-head" x="${trainX - 8}" y="${trainY}" width="16" height="8" rx="2"/>
          <!-- Train car 1 -->
          <rect class="train-car" x="${trainX - 6}" y="${trainY + 8}" width="12" height="6"/>
          <!-- Train coupling -->
          <rect class="train-coupling" x="${trainX - 1}" y="${trainY + 14}" width="2" height="2"/>
          <!-- Train car 2 -->
          <rect class="train-car" x="${trainX - 6}" y="${trainY + 16}" width="12" height="6"/>
        </g>
      `;
    }
  }

  // Title
  const title = `<text x="${chartWidth / 2}" y="20" text-anchor="middle" font-family="'Courier New', monospace" font-size="16" font-weight="bold" fill="#000">Platform Usage: ${dayOfWeek} ${std}</text>`;

  // Subtitle with total days
  const totalDays = platformCounts.reduce((sum, item) => sum + item.count, 0);
  const subtitle = `<text x="${chartWidth / 2}" y="35" text-anchor="middle" font-family="'Courier New', monospace" font-size="12" fill="#666">Total days observed: ${totalDays}</text>`;

  return `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style type="text/css">
        <![CDATA[
        .train-car { fill: #2c3e50; stroke: #000; stroke-width: 1; }
        .train-car:nth-child(odd) { fill: #34495e; }
        .train-car:nth-child(even) { fill: #2c3e50; }
        .train-coupling { fill: #7f8c8d; stroke: #000; stroke-width: 0.5; }
        .platform-bar { fill: #000; }
        .platform-bar.has-train { fill: #f8f9fa; stroke: #dee2e6; stroke-width: 1; }
        .train-head { fill: #e74c3c; stroke: #c0392b; stroke-width: 1; }
        .train-icon { animation: trainPulse 3s ease-in-out infinite alternate; }
        @keyframes trainPulse { 0% { opacity: 0.9; } 100% { opacity: 1; } }
        ]]>
      </style>
    </defs>
    ${title}
    ${subtitle}
    ${labels}
    ${bars}
    ${trainIcon}
  </svg>`;
}

// Graceful shutdown. This is a signal handler that runs when the server is shut down.
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  trainDB.close();
  process.exit(0);
});
