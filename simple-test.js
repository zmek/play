const fetch = require('node-fetch');

async function testExactUrl() {
    const url = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard/TLH';
    const apiKey = '5QR6QPw9lzc1Gb7iN2D7lAxGqGaIC3wR2JRydzF0arzCh4At';

    console.log('Testing exact URL:', url);
    console.log('Using API key:', apiKey.substring(0, 8) + '...');

    try {
        const response = await fetch(url, {
            headers: {
                'x-apikey': apiKey,
                'Content-Type': 'application/json'
            }
        });

        console.log('Status:', response.status, response.statusText);
        console.log('Headers:', Object.fromEntries(response.headers.entries()));

        if (response.ok) {
            const data = await response.json();
            console.log('✅ SUCCESS!');
            console.log('Response:', JSON.stringify(data, null, 2));
        } else {
            const errorText = await response.text();
            console.log('❌ Error Response:', errorText);
        }
    } catch (error) {
        console.log('❌ Exception:', error.message);
    }
}

testExactUrl();
