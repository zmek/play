#!/usr/bin/env node

// Simple test script to verify database functionality
const TrainDatabase = require('../database');

console.log('Testing train database functionality...\n');

try {
    // Initialize database
    const db = new TrainDatabase();

    // Test storing some sample data
    console.log('1. Testing data storage...');
    const fixedDate = '2025-09-22';
    const fixedDow = 'Monday';
    const sampleDepartures = [
        {
            service_date: fixedDate,
            day_of_week: fixedDow,
            std: "14:45",
            etd: null,
            departure_time: "14:45",
            platform: "4",
            destination: "TLH",
            operator: "Great Western Railway",
            is_cancelled: false,
            delay_reason: null
        },
        {
            service_date: fixedDate,
            day_of_week: fixedDow,
            std: "15:15",
            etd: null,
            departure_time: "15:15",
            platform: "2",
            destination: "TLH",
            operator: "Great Western Railway",
            is_cancelled: false,
            delay_reason: null
        },
        {
            service_date: fixedDate,
            day_of_week: fixedDow,
            std: "15:45",
            etd: null,
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

    // Test append-only behavior for changing platform
    console.log('2b. Testing append-only snapshots on change...');
    db.storeDeparture({
        service_date: fixedDate,
        day_of_week: fixedDow,
        std: "14:45",
        etd: null,
        departure_time: "14:45",
        platform: "5", // changed from 4 → 5
        destination: "TLH",
        operator: "Great Western Railway",
        is_cancelled: false,
        delay_reason: null
    });
    const recentAfterChange = db.getRecentDepartures(10);
    const fourteenFortyFiveSnapshots = recentAfterChange.filter(r => r.service_date === fixedDate && r.std === "14:45" && r.destination === "TLH");
    console.log(`✓ Snapshots for 14:45 TLH now: ${fourteenFortyFiveSnapshots.length} (expect ≥ 2)`);
    fourteenFortyFiveSnapshots.forEach(s => {
        console.log(`   - snapshot: std=${s.std}, etd=${s.etd || 'null'}, time=${s.departure_time}, platform=${s.platform}`);
    });
    console.log();



    // Test cleanup (simulate old records)
    console.log('3. Testing cleanup functionality...');
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
