#!/usr/bin/env node

/**
 * Quick test of dashboard functionality
 */

import { initializeDashboardSheet, updateDashboardStats } from './googleSheets.js';

console.log('🧪 Testing dashboard functionality...\n');

async function testDashboard() {
  try {
    // Test 1: Initialize dashboard
    console.log('1️⃣ Testing dashboard initialization...');
    await initializeDashboardSheet();
    console.log('✅ Dashboard initialization successful\n');
    
    // Test 2: Update stats
    console.log('2️⃣ Testing dashboard stats update...');
    const testStats = {
      totalProcessed: 42,
      successRate: 95,
      avgResponseTime: 1250
    };
    
    await updateDashboardStats(testStats);
    console.log('✅ Dashboard stats update successful\n');
    
    console.log('🎉 All dashboard tests passed!');
    console.log('📊 Check your Google Sheet for the new Dashboard tab');
    
  } catch (error) {
    console.error('❌ Dashboard test failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

testDashboard();