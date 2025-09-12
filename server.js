const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files (your HTML page)
app.use(express.static('public'));

// LDBWS API configuration
// You'll need to replace these with actual values
const LDBWS_BASE_URL = 'http://localhost/LDBWS'; // Replace with actual API URL
const LDBWS_TOKEN = 'your-token-here'; // Replace with your actual token

// API endpoint to get next train
app.get('/api/next-train/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    
    // Make request to LDBWS API
    const apiUrl = `${LDBWS_BASE_URL}/api/20220120/GetNextDepartures/${from}/${to}`;
    
    console.log(`Fetching: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(LDBWS_TOKEN + ':').toString('base64')}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('Error fetching train data:', error);
    
    // Return mock data for development
    res.json({
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
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// Serve the main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api/next-train/PAD/TLH`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  process.exit(0);
});
