const fetch = require('node-fetch');

// Quick API test - just checks if we can connect
const LDBWS_BASE_URL = process.env.LDBWS_BASE_URL || 'http://localhost';
const LDBWS_API_KEY = process.env.LDBWS_API_KEY || 'your-api-key-here';

async function quickTest() {
    // Test the working URL pattern from the example
    const apiUrl = `${LDBWS_BASE_URL}/LDBWS/api/20220120/GetDepartureBoard/TLH`;

    console.log('Testing URL:', apiUrl);

    try {
        const response = await fetch(apiUrl, {
            headers: {
                'x-apikey': LDBWS_API_KEY
            }
        });

        console.log(`Status: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log('✅ API Working! Found', data.trainServices?.length || 0, 'train services');
            if (data.trainServices && data.trainServices.length > 0) {
                console.log('First service:', data.trainServices[0].std, 'to', data.trainServices[0].destination?.[0]?.locationName);
            }
        } else {
            const errorText = await response.text();
            console.log('❌ API Error:', response.status, response.statusText);
            console.log('Error details:', errorText);
        }
    } catch (error) {
        console.log('❌ Connection Error:', error.message);
    }
}

quickTest();
