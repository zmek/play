#!/usr/bin/env node

// Simple test script to verify database functionality
const TrainDatabase = require('./database');

console.log('Testing train database functionality...\n');

try {
    // Initialize database
    const db = new TrainDatabase();

    // Test storing some sample data
    console.log('1. Testing data storage...');
    const sampleDepartures = [
        {
            departure_time: "14:45",
            platform: "4",
            destination: "TLH",
            operator: "Great Western Railway",
            is_cancelled: false,
            delay_reason: null
        },
        {
            departure_time: "15:15",
            platform: "2",
            destination: "TLH",
            operator: "Great Western Railway",
            is_cancelled: false,
            delay_reason: null
        },
        {
            departure_time: "15:45",
            platform: "4",
            destination: "TLH",
            operator: "Great Western Railway",
            is_cancelled: true,
            delay_reason: "Signal failure"
        }
    ];

    sampleDepartures.forEach(departure => {
        db.storeDeparture(departure);
    });
    console.log('✓ Sample data stored successfully\n');

    // Test retrieving recent departures
    console.log('2. Testing recent departures retrieval...');
    const recent = db.getRecentDepartures(5);
    console.log(`✓ Retrieved ${recent.length} recent departures:`);
    recent.forEach(dep => {
        console.log(`   - ${dep.departure_time} from Platform ${dep.platform} to ${dep.destination} (${dep.is_cancelled ? 'CANCELLED' : 'On time'})`);
    });
    console.log();

    // Test platform-specific queries
    console.log('3. Testing platform-specific queries...');
    const platform4 = db.getDeparturesByPlatform("4");
    console.log(`✓ Retrieved ${platform4.length} departures from Platform 4:`);
    platform4.forEach(dep => {
        console.log(`   - ${dep.departure_time} to ${dep.destination} (${dep.is_cancelled ? 'CANCELLED' : 'On time'})`);
    });
    console.log();

    // Test platform statistics
    console.log('4. Testing platform statistics...');
    const stats = db.getPlatformStats();
    console.log('✓ Platform statistics:');
    stats.forEach(stat => {
        console.log(`   - Platform ${stat.platform}: ${stat.count} total, ${stat.on_time_count} on time, ${stat.cancelled_count} cancelled`);
    });
    console.log();

    // Test cleanup (simulate old records)
    console.log('5. Testing cleanup functionality...');
    const cleaned = db.cleanupOldRecords();
    console.log(`✓ Cleaned up ${cleaned} old records\n`);

    // Close database
    db.close();

    console.log('✅ All database tests passed successfully!');
    console.log('\nDatabase file created at: ./data/train_departures.db');
    console.log('You can now start the server with: npm start');

} catch (error) {
    console.error('❌ Database test failed:', error.message);
    process.exit(1);
}
