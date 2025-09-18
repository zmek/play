const fetch = require('node-fetch');

// Configuration - prefer GetNextDepartures credentials if provided
const LDBWS_BASE_URL = process.env.LDBWS_BASE_URL || 'http://localhost';
const LDBWS_API_KEY = process.env.LDBWS_API_KEY || 'your-api-key-here';
const NEXTDEPS_BASE_URL = process.env.NEXTDEPS_BASE_URL || 'http://localhost';
const NEXTDEPS_API_KEY = process.env.NEXTDEPS_API_KEY || 'your-api-key-here';

// Test parameters
const FROM_STATION = 'PAD'; // Paddington
const TO_STATION = 'TLH';   // Tilehurst

async function testAPI() {
    console.log('🚂 Testing LDBWS API Connection...\n');

    // Build the API URL
    const apiUrl = `${NEXTDEPS_BASE_URL}/LDBWS/api/20220120/GetNextDepartures/${FROM_STATION}/${TO_STATION}?timeOffset=0&timeWindow=120`;

    console.log('📋 Test Configuration:');
    console.log(`   Base URL: ${NEXTDEPS_BASE_URL}`);
    console.log(`   API Key: ${NEXTDEPS_API_KEY.substring(0, 8)}...`);
    console.log(`   From Station: ${FROM_STATION} (Paddington)`);
    console.log(`   To Station: ${TO_STATION} (Tilehurst)`);
    console.log(`   Full URL: ${apiUrl}\n`);

    try {
        console.log('🔄 Making API request...');

        const response = await fetch(apiUrl, {
            headers: {
                'x-apikey': NEXTDEPS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(`📊 Response Status: ${response.status} ${response.statusText}`);
        console.log(`📊 Response Headers:`, Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Error Response: ${errorText}`);
            return;
        }

        const data = await response.json();

        console.log('\n✅ API Request Successful!');
        console.log('📄 Response Data:');
        console.log(JSON.stringify(data, null, 2));

        // Test data structure
        if (data.departures && data.departures.length > 0) {
            console.log('\n🚂 Found Departures:');
            data.departures.forEach((departure, index) => {
                const service = departure.service;
                console.log(`   ${index + 1}. Departure to ${departure.crs}`);
                console.log(`      Scheduled: ${service.std}`);
                console.log(`      Expected: ${service.etd}`);
                console.log(`      Platform: ${service.platform}`);
                console.log(`      Operator: ${service.operator}`);
                console.log(`      Cancelled: ${service.isCancelled}`);
            });
        } else {
            console.log('\n⚠️  No departures found in response');
        }

    } catch (error) {
        console.log(`❌ Error: ${error.message}`);

        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 Troubleshooting Tips:');
            console.log('   - Make sure the LDBWS API server is running');
            console.log('   - Check if the base URL is correct');
            console.log('   - Verify the server is accessible on the specified port');
        } else if (error.message.includes('fetch')) {
            console.log('\n💡 Troubleshooting Tips:');
            console.log('   - Check your internet connection');
            console.log('   - Verify the API endpoint URL');
            console.log('   - Ensure the API server is responding');
        }
    }
}

// Run the test
testAPI();
