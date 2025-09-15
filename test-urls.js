const fetch = require('node-fetch');

const LDBWS_BASE_URL = process.env.LDBWS_BASE_URL || 'https://api1.raildata.org.uk';
const LDBWS_API_KEY = process.env.LDBWS_API_KEY || 'your-api-key-here';

async function testUrl(url, description) {
    try {
        console.log(`\n🧪 Testing: ${description}`);
        console.log(`   URL: ${url}`);

        const response = await fetch(url, {
            headers: {
                'x-apikey': LDBWS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log(`   Status: ${response.status} ${response.statusText}`);

        if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ SUCCESS! Found ${data.departures?.length || 0} departures`);
            return true;
        } else {
            const errorText = await response.text();
            console.log(`   ❌ Error: ${errorText.substring(0, 100)}...`);
        }
    } catch (error) {
        console.log(`   ❌ Exception: ${error.message}`);
    }
    return false;
}

async function testAllUrls() {
    console.log('🔍 Testing different URL patterns...');

    const urls = [
        {
            url: `${LDBWS_BASE_URL}/LDBWS/api/20220120/GetNextDepartures/PAD/TLH?timeOffset=0&timeWindow=120`,
            desc: 'Original OpenAPI spec pattern'
        },
        {
            url: `${LDBWS_BASE_URL}/api/20220120/GetNextDepartures/PAD/TLH?timeOffset=0&timeWindow=120`,
            desc: 'Without /LDBWS prefix'
        },
        {
            url: `${LDBWS_BASE_URL}/GetNextDepartures/PAD/TLH?timeOffset=0&timeWindow=120`,
            desc: 'Direct endpoint'
        },
        {
            url: `${LDBWS_BASE_URL}/api/GetNextDepartures/PAD/TLH?timeOffset=0&timeWindow=120`,
            desc: 'Simple /api prefix'
        },
        {
            url: `${LDBWS_BASE_URL}/20220120/GetNextDepartures/PAD/TLH?timeOffset=0&timeWindow=120`,
            desc: 'Version only'
        }
    ];

    for (const { url, desc } of urls) {
        const success = await testUrl(url, desc);
        if (success) {
            console.log(`\n🎉 Found working URL pattern: ${desc}`);
            break;
        }
    }
}

testAllUrls();
