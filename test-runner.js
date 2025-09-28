#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Simple test runner that discovers and runs all test files
class TestRunner {
    constructor() {
        this.testFiles = [];
        this.results = [];
        this.serverProcess = null;
    }

    // Discover all test files
    discoverTests() {
        const testDir = path.join(__dirname, 'tests');
        const files = fs.readdirSync(testDir);

        this.testFiles = files
            .filter(file => file.startsWith('test-') && file.endsWith('.js'))
            .map(file => path.join(testDir, file));

        console.log(`🔍 Discovered ${this.testFiles.length} test files:`);
        this.testFiles.forEach(file => {
            console.log(`   - ${path.basename(file)}`);
        });
        console.log();
    }

    // Check if server is running
    async checkServer() {
        const fetch = require('node-fetch');
        try {
            const response = await fetch('http://127.0.0.1:3000/api/health');
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    // Start the server if needed
    async startServer() {
        const isRunning = await this.checkServer();
        if (isRunning) {
            console.log('✅ Server is already running\n');
            return true;
        }

        console.log('🚀 Starting server...');
        return new Promise((resolve, reject) => {
            this.serverProcess = spawn('node', ['server.js'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
            });

            let serverReady = false;
            const timeout = setTimeout(() => {
                if (!serverReady) {
                    console.log('❌ Server failed to start within 10 seconds');
                    this.serverProcess.kill();
                    reject(new Error('Server startup timeout'));
                }
            }, 10000);

            this.serverProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('Server running at')) {
                    serverReady = true;
                    clearTimeout(timeout);
                    console.log('✅ Server started successfully\n');
                    resolve(true);
                }
            });

            this.serverProcess.stderr.on('data', (data) => {
                console.error('Server error:', data.toString());
            });

            this.serverProcess.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    // Run a single test file
    async runTest(testFile) {
        return new Promise((resolve) => {
            const testName = path.basename(testFile);
            console.log(`🧪 Running ${testName}...`);

            const startTime = Date.now();
            const child = spawn('node', [testFile], {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data) => {
                output += data.toString();
            });

            child.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            child.on('close', (code) => {
                const duration = Date.now() - startTime;
                const result = {
                    file: testName,
                    success: code === 0,
                    exitCode: code,
                    duration: duration,
                    output: output,
                    error: errorOutput
                };

                this.results.push(result);

                if (code === 0) {
                    console.log(`✅ ${testName} passed (${duration}ms)`);
                } else {
                    console.log(`❌ ${testName} failed (${duration}ms)`);
                    if (errorOutput) {
                        console.log(`   Error: ${errorOutput.trim()}`);
                    }
                }
                console.log();
                resolve(result);
            });
        });
    }

    // Run all tests
    async runAllTests() {
        console.log('🚂 Train API Test Suite\n');
        console.log('='.repeat(50));

        this.discoverTests();

        // Check if we need to start the server
        const needsServer = this.testFiles.some(file =>
            path.basename(file).includes('api') ||
            path.basename(file).includes('urls') ||
            path.basename(file).includes('platforms')
        );

        if (needsServer) {
            try {
                await this.startServer();
            } catch (error) {
                console.log('❌ Failed to start server, skipping server-dependent tests');
                this.testFiles = this.testFiles.filter(file =>
                    path.basename(file) === 'test-database.js'
                );
            }
        }

        // Run all tests
        for (const testFile of this.testFiles) {
            await this.runTest(testFile);
        }

        this.printSummary();
        this.cleanup();
    }

    // Print test summary
    printSummary() {
        console.log('='.repeat(50));
        console.log('📊 Test Summary');
        console.log('='.repeat(50));

        const passed = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        const total = this.results.length;
        const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

        console.log(`Total tests: ${total}`);
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);
        console.log(`Total time: ${totalTime}ms`);
        console.log();

        if (failed > 0) {
            console.log('❌ Failed tests:');
            this.results.filter(r => !r.success).forEach(r => {
                console.log(`   - ${r.file}`);
            });
            console.log();
        }

        if (passed === total) {
            console.log('🎉 All tests passed!');
        } else {
            console.log('💥 Some tests failed');
            process.exit(1);
        }
    }

    // Cleanup
    cleanup() {
        if (this.serverProcess) {
            console.log('🛑 Stopping server...');
            this.serverProcess.kill();
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Test run interrupted');
    process.exit(1);
});

// Run the tests
if (require.main === module) {
    const runner = new TestRunner();
    runner.runAllTests().catch(error => {
        console.error('❌ Test runner failed:', error.message);
        process.exit(1);
    });
}

module.exports = TestRunner;
