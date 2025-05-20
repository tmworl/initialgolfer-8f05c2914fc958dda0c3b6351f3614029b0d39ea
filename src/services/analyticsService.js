// src/services/analyticsService.js
import { supabase } from './supabase';

// Original console methods backup
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn
};

// Analytics endpoint 
const ANALYTICS_ENDPOINT = 'https://mxqhgktcdmymmwbsbfws.supabase.co/functions/v1/track-analytics';

// Service state
let analyticsInitialized = false;
let userId = null;

/**
 * Send any console message to analytics
 */
const sendToAnalytics = (level, args) => {
  if (!analyticsInitialized) return;
  
  try {
    // Convert args to string for consistent handling
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    // Extract data object if it exists as second parameter
    const data = (args.length > 1 && typeof args[1] === 'object') ? args[1] : {};
    
    // Send to edge function
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'console_' + level,
        distinct_id: userId || 'anonymous',
        properties: {
          message: message,
          data: data,
          level: level,
          timestamp: new Date().toISOString()
        }
      })
    }).catch(err => originalConsole.error('Analytics error:', err));
  } catch (err) {
    originalConsole.error('Analytics send error:', err);
  }
};

/**
 * Initialize analytics service
 */
const initAnalytics = async () => {
  if (analyticsInitialized) return;
  
  try {
    // Get user ID if available
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id || null;
    
    // Override console methods
    console.log = function() {
      originalConsole.log.apply(console, arguments);
      sendToAnalytics('log', Array.from(arguments));
    };

    console.error = function() {
      originalConsole.error.apply(console, arguments);
      sendToAnalytics('error', Array.from(arguments));
    };

    console.warn = function() {
      originalConsole.warn.apply(console, arguments);
      sendToAnalytics('warn', Array.from(arguments));
    };
    
    analyticsInitialized = true;
  } catch (err) {
    originalConsole.error('Error initializing analytics:', err);
  }
};

/**
 * Reset analytics (for logout)
 */
const resetAnalytics = () => {
  // Reset override functions
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  
  // Reset state
  analyticsInitialized = false;
  userId = null;
};

export default {
  initAnalytics,
  resetAnalytics
};