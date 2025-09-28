const fetch = require('node-fetch');

// Test the new service platform counts endpoint
async function testServicePlatforms() {
    console.log('🚂 Testing Service Platform Counts API...\n');

    const baseUrl = 'http://127.0.0.1:3000';

    // Test the all-services endpoint first
    console.log('📋 Testing: All Services Platform Data');
    const allServicesUrl = `${baseUrl}/api/all-platforms`;
    console.log(`   URL: ${allServicesUrl}`);

    try {
        const response = await fetch(allServicesUrl);
        console.log(`   Status: ${response.status} ${response.statusText}`);

        if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ Success!`);
            console.log(`   Total services found: ${data.totalServices}`);
            console.log(`   Generated at: ${data.generatedAt}`);

            if (data.services.length === 0) {
                console.log(`   No services found in database`);
            } else {
                console.log(`   Sample services:`);
                // Show first 3 services as examples
                data.services.slice(0, 3).forEach((service, index) => {
                    console.log(`     ${index + 1}. ${service.dayOfWeek} ${service.scheduledTime} to ${service.destination}`);
                    console.log(`        Platforms: ${service.platformCounts.map(p => `${p.platform}(${p.count})`).join(', ')}`);
                    console.log(`        Total days: ${service.totalDays}`);
                });

                if (data.services.length > 3) {
                    console.log(`     ... and ${data.services.length - 3} more services`);
                }
            }
        } else {
            const errorData = await response.json();
            console.log(`   ❌ Error: ${errorData.error}`);
        }
    } catch (error) {
        console.log(`   ❌ Request failed: ${error.message}`);
    }

    console.log('\n📋 Testing: Individual Service Platform Counts');

    // Test parameters - you may need to adjust these based on actual data in your database
    const testCases = [
        { dayOfWeek: 'Monday', std: '08:30' },
        { dayOfWeek: 'Friday', std: '17:15' },
        { dayOfWeek: 'Wednesday', std: '12:00' }
    ];

    for (const testCase of testCases) {
        const { dayOfWeek, std } = testCase;
        const url = `${baseUrl}/api/platforms/${dayOfWeek}/${std}`;

        console.log(`📋 Testing: ${dayOfWeek} at ${std}`);
        console.log(`   URL: ${url}`);

        try {
            const response = await fetch(url);
            console.log(`   Status: ${response.status} ${response.statusText}`);

            if (response.ok) {
                const data = await response.json();
                console.log(`   ✅ Success!`);
                console.log(`   Service: ${data.service.dayOfWeek} at ${data.service.scheduledTime}`);
                console.log(`   Total days with data: ${data.totalDays}`);
                console.log(`   Platform counts:`);

                if (data.platformCounts.length === 0) {
                    console.log(`     No platform data found for this service`);
                } else {
                    data.platformCounts.forEach(item => {
                        console.log(`     Platform ${item.platform}: ${item.count} days`);
                    });
                }
            } else {
                const errorData = await response.json();
                console.log(`   ❌ Error: ${errorData.error}`);
            }
        } catch (error) {
            console.log(`   ❌ Request failed: ${error.message}`);
        }

        console.log('');
    }

    // Test invalid parameters
    console.log('🧪 Testing invalid parameters...\n');

    const invalidTests = [
        { url: `${baseUrl}/api/platforms/InvalidDay/08:30`, description: 'Invalid day of week' },
        { url: `${baseUrl}/api/platforms/Monday/25:00`, description: 'Invalid time format' },
        { url: `${baseUrl}/api/platforms/Monday/invalid`, description: 'Non-time format' }
    ];

    for (const test of invalidTests) {
        console.log(`📋 Testing: ${test.description}`);
        console.log(`   URL: ${test.url}`);

        try {
            const response = await fetch(test.url);
            console.log(`   Status: ${response.status} ${response.statusText}`);

            if (response.status === 400) {
                const errorData = await response.json();
                console.log(`   ✅ Correctly rejected: ${errorData.error}`);
            } else {
                console.log(`   ⚠️  Expected 400 status for invalid input`);
            }
        } catch (error) {
            console.log(`   ❌ Request failed: ${error.message}`);
        }

        console.log('');
    }
}

// Check if server is running first
async function checkServer() {
    try {
        const response = await fetch('http://127.0.0.1:3000/api/health');
        if (response.ok) {
            console.log('✅ Server is running\n');
            return true;
        }
    } catch (error) {
        console.log('❌ Server is not running or not accessible');
        console.log('   Make sure to start the server first: npm start');
        return false;
    }
}

// Run the test
async function main() {
    const serverRunning = await checkServer();
    if (serverRunning) {
        await testServicePlatforms();
    }
}

main();
