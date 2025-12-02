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
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // Ensure no caching
    res.send(svg);
  } catch (error) {
    console.error('Error generating chart:', error);
    res.status(500).json({ error: 'Failed to generate chart' });
  }
});

// Generate SVG chart for any specific service
app.get('/api/service-chart/:dayOfWeek/:std/:destination?', (req, res) => {
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

    // Get platform counts for this service
    const platformCounts = trainDB.getServicePlatformCounts(dayOfWeek, std, destination);

    if (!platformCounts || platformCounts.length === 0) {
      // Return a chart showing no platform data instead of 404
      const emptyPlatformCounts = [];
      const svg = generatePlatformChart(emptyPlatformCounts, dayOfWeek, std, null);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
      return;
    }

    // Generate SVG chart (no current platform since this is historical data)
    const svg = generatePlatformChart(platformCounts, dayOfWeek, std, null);

    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (error) {
    console.error('Error generating service chart:', error);
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
  console.log(`  - Service chart: http://localhost:${PORT}/api/service-chart/Monday/08:30 (destination defaults to TLH)`);
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
// DISABLED: Automatic cleanup is currently disabled
// setInterval(() => {
//   trainDB.cleanupOldRecords();
// }, 12 * 60 * 60 * 1000); // 12 hours

// Generate SVG chart for platform distribution (Kraftwerk Style)
function generatePlatformChart(platformCounts, dayOfWeek, std, currentPlatform = null) {
  console.log(`Generating chart for ${dayOfWeek} ${std}. Counts:`, JSON.stringify(platformCounts));
  // Create a map of platform counts for easy lookup
  const platformMap = {};
  platformCounts.forEach(item => {
    platformMap[item.platform] = item.count;
  });
  console.log('Platform Map:', JSON.stringify(platformMap));

  // Chart dimensions
  const width = 800;
  const height = 500;

  // Perspective Constants
  const vpX = width / 2;       // Vanishing Point X (center)
  const vpY = height * 0.2;    // Vanishing Point Y (horizon line, upper part of screen)
  const startY = height;       // Start Y (bottom of screen)
  const convergence = 0.5;     // Reduced from 0.8 to 0.5 to make distant objects larger

  // Track Configuration
  const totalTracks = 14;      // We have 14 platforms

  // Calculate spacing to fit all tracks within the width with some margin
  const margin = 100;
  const availableWidth = width - margin * 2;
  const spacing = availableWidth / (totalTracks - 1); // Spacing between centers

  // Helper function for 3D to 2D projection
  // x: lateral offset from center (0 is center)
  // z: depth (0 is closest, increases into distance)
  function project(x, z) {
    const scale = 1 / (z * convergence + 1);

    // x is already in screen coordinates relative to center
    // We don't need an extra spread factor if we calculate x correctly for z=0
    const px = vpX + x * scale;
    const py = vpY + (startY - vpY) * scale;

    return { x: px, y: py, scale };
  }

  let svgContent = '';

  // 1. Draw Tracks
  for (let i = 0; i < totalTracks; i++) {
    const platformNum = i + 1;

    // Calculate lateral position (x) relative to center for z=0
    // i=0 -> -availableWidth/2
    // i=13 -> +availableWidth/2
    const xOffset = -availableWidth / 2 + i * spacing;

    const trackRadius = 15; // Increased from 10 to 15 (Wider tracks)

    const leftRailX = xOffset - trackRadius;
    const rightRailX = xOffset + trackRadius;

    // Project start (z=0) and end (z=10) points
    const zFar = 20;

    const pStartLeft = project(leftRailX, 0);
    const pStartRight = project(rightRailX, 0);
    const pEndLeft = project(leftRailX, zFar);
    const pEndRight = project(rightRailX, zFar);

    // Draw Rails
    // Left Rail
    svgContent += `<line x1="${pStartLeft.x}" y1="${pStartLeft.y}" x2="${pEndLeft.x}" y2="${pEndLeft.y}" class="track-line" />`;
    // Right Rail
    svgContent += `<line x1="${pStartRight.x}" y1="${pStartRight.y}" x2="${pEndRight.x}" y2="${pEndRight.y}" class="track-line" />`;

    // 2. Draw Sleepers (Data) - Matrix Cells
    const count = platformMap[platformNum] || 0;

    // Matrix Cell Configuration
    const cellSpacing = 0.5; // Spacing between cell centers in Z
    const cellGap = 0.05;    // Small gap between cells in Z
    const cellZSize = cellSpacing - cellGap; // Physical Z-length of the cell

    // To fit inside tracks:
    // Track radius is 15. Let's make cells slightly narrower.
    const cellPadding = 3;
    const cellLeftX = leftRailX + cellPadding;
    const cellRightX = rightRailX - cellPadding;

    for (let j = 0; j < count; j++) {
      // Start from very near foreground (z=0)
      const zStart = j * cellSpacing;
      const zEnd = zStart + cellZSize;

      if (zStart > zFar) break; // Clip if too far

      // Calculate 4 corners of the cell
      const p1 = project(cellLeftX, zStart);  // Front-Left
      const p2 = project(cellRightX, zStart); // Front-Right
      const p3 = project(cellRightX, zEnd);   // Back-Right
      const p4 = project(cellLeftX, zEnd);    // Back-Left

      let sleeperClass = 'sleeper-cell';
      if (currentPlatform && parseInt(currentPlatform) === platformNum) {
        sleeperClass += ' active-platform-sleeper';
      }

      // Render as polygon to ensure correct perspective (trapezoid shape)
      svgContent += `<polygon points="${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y} ${p4.x},${p4.y}" class="${sleeperClass}" />`;
    }

    // Platform Label (at the bottom)
    svgContent += `<text x="${(pStartLeft.x + pStartRight.x) / 2}" y="${height - 10}" class="platform-label" text-anchor="middle">${platformNum}</text>`;
  }

  // Title
  const title = `<text x="${width / 2}" y="40" text-anchor="middle" class="chart-title">Platform Usage: ${dayOfWeek} ${std}</text>`;
  const subtitle = `<text x="${width / 2}" y="65" text-anchor="middle" class="chart-subtitle">Total days observed: ${platformCounts.reduce((sum, item) => sum + item.count, 0)}</text>`;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <style type="text/css">
        <![CDATA[
        .track-line { stroke: #FFFFFF; stroke-width: 1; filter: url(#glow); opacity: 0.3; }
        .sleeper-line { stroke: #FFFFFF; stroke-linecap: butt; }
        .sleeper-cell { fill: #FFFFFF; } /* Matrix cell: Filled polygon */
        .active-platform-sleeper { fill: #FFFFFF; }
        .platform-label { fill: #666; font-family: 'Courier New', monospace; font-size: 12px; }
        .chart-title { fill: #FFF; font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; letter-spacing: 2px; }
        .chart-subtitle { fill: #999; font-family: 'Courier New', monospace; font-size: 12px; }
        ]]>
      </style>
    </defs>
    <rect width="100%" height="100%" fill="#000000" />
    ${title}
    ${subtitle}
    ${svgContent}
  </svg>`;
}

// Graceful shutdown. This is a signal handler that runs when the server is shut down.
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  trainDB.close();
  process.exit(0);
});
