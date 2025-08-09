#!/usr/bin/env node

/**
 * Quick test of dashboard functionality
 */

import { initializeDashboardSheet, updateDashboardStats } from './googleSheets.js';

console.log('🧪 בדיקת תפקוד לוח הבקרה...\n');

async function testDashboard() {
  try {
    // Test 1: Initialize dashboard
    console.log('1️⃣ בודק אתחול לוח בקרה...');
    await initializeDashboardSheet();
    console.log('✅ אתחול לוח בקרה הצליח\n');
    
    // Test 2: Update stats
    console.log('2️⃣ בודק עדכון סטטיסטיקות לוח בקרה...');
    const testStats = {
      totalProcessed: 42,
      successRate: 95,
      avgResponseTime: 1250
    };
    
    await updateDashboardStats(testStats);
    console.log('✅ עדכון סטטיסטיקות לוח בקרה הצליח\n');
    
    console.log('🎉 כל בדיקות לוח הבקרה עברו בהצלחה!');
    console.log('📊 בדיקת הגיליון שלך בגוגל לטאב לוח הבקרה החדש');
    
  } catch (error) {
    console.error('❌ בדיקת לוח הבקרה נכשלה:', error.message);
    if (error.stack) {
      console.error('מעקב שגיאה:', error.stack);
    }
    process.exit(1);
  }
}

testDashboard();