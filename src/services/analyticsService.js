// src/services/analyticsService.js
//
// Global console interception service for automatic PostHog analytics
// Intercepts ALL console logs/errors and sends them to PostHog via batching

/**
 * Global Console Interception Analytics Service
 * Automatically captures all console logs and sends them to PostHog
 * Preserves original console behavior while duplicating to analytics
 */
class ConsoleAnalyticsService {
  constructor() {
    this.posthog = null;
    this.originalConsole = {};
    this.isInitialized = false;
    this.eventQueue = [];
  }

  /**
   * Initialize the service with PostHog instance and start console interception
   * @param {Object} posthogInstance - PostHog instance from usePostHog()
   */
  init(posthogInstance) {
    if (this.isInitialized) return;
    
    this.posthog = posthogInstance;
    this.interceptConsoleMethods();
    this.isInitialized = true;
    
    console.log('[Analytics] Global console interception enabled');
  }

  /**
   * Intercept all console methods globally
   * Preserves original behavior while sending to PostHog
   */
  interceptConsoleMethods() {
    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    };

    // Override console.log
    console.log = (...args) => {
      this.originalConsole.log(...args);
      this.sendToAnalytics('console_log', args, 'log');
    };

    // Override console.error
    console.error = (...args) => {
      this.originalConsole.error(...args);
      this.sendToAnalytics('console_error', args, 'error');
    };

    // Override console.warn
    console.warn = (...args) => {
      this.originalConsole.warn(...args);
      this.sendToAnalytics('console_warn', args, 'warn');
    };

    // Override console.info
    console.info = (...args) => {
      this.originalConsole.info(...args);
      this.sendToAnalytics('console_info', args, 'info');
    };

    // Override console.debug
    console.debug = (...args) => {
      this.originalConsole.debug(...args);
      this.sendToAnalytics('console_debug', args, 'debug');
    };
  }

  /**
   * Send console data to PostHog
   * @param {string} eventName - Event name for PostHog
   * @param {Array} args - Console arguments
   * @param {string} level - Log level (log, error, warn, etc.)
   */
  sendToAnalytics(eventName, args, level) {
    try {
      if (!this.posthog) {
        // Queue events if PostHog not ready yet
        this.eventQueue.push({ eventName, args, level, timestamp: Date.now() });
        return;
      }

      // Process queued events if any
      if (this.eventQueue.length > 0) {
        this.eventQueue.forEach(queuedEvent => {
          this.captureEvent(queuedEvent.eventName, queuedEvent.args, queuedEvent.level, queuedEvent.timestamp);
        });
        this.eventQueue = [];
      }

      // Send current event
      this.captureEvent(eventName, args, level);

    } catch (error) {
      // Use original console to avoid infinite loop
      this.originalConsole.error('[Analytics] Failed to send console event:', error);
    }
  }

  /**
   * Capture event to PostHog with formatted data
   * @param {string} eventName - Event name
   * @param {Array} args - Console arguments
   * @param {string} level - Log level
   * @param {number} timestamp - Optional timestamp for queued events
   */
  captureEvent(eventName, args, level, timestamp = null) {
    // Format arguments into a readable message
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Extract structured data from common log patterns
    const structuredData = this.extractStructuredData(message, args);

    // Send to PostHog with comprehensive context
    this.posthog.capture(eventName, {
      message,
      level,
      timestamp: timestamp || new Date().toISOString(),
      arg_count: args.length,
      has_objects: args.some(arg => typeof arg === 'object'),
      ...structuredData
    });
  }

  /**
   * Extract structured data from console logs for better analytics
   * @param {string} message - Formatted message
   * @param {Array} args - Original arguments
   * @returns {Object} Structured data
   */
  extractStructuredData(message, args) {
    const data = {};

    // Extract golf-specific events from common log patterns
    if (message.includes('Starting round')) {
      data.event_type = 'round_start';
      data.golf_event = true;
    } else if (message.includes('Round completed')) {
      data.event_type = 'round_complete';
      data.golf_event = true;
    } else if (message.includes('Adding') && message.includes('shot')) {
      data.event_type = 'shot_tracking';
      data.golf_event = true;
    } else if (message.includes('Error')) {
      data.event_type = 'error';
      data.is_error = true;
    } else if (message.includes('course') || message.includes('Course')) {
      data.event_type = 'course_related';
      data.golf_event = true;
    }

    // Extract screen context if available
    if (message.includes('TrackerScreen') || message.includes('Tracker')) {
      data.screen = 'tracker';
    } else if (message.includes('CourseSelector') || message.includes('course')) {
      data.screen = 'course_selector';
    } else if (message.includes('HomeScreen') || message.includes('Home')) {
      data.screen = 'home';
    }

    return data;
  }

  /**
   * Restore original console methods (for cleanup if needed)
   */
  restore() {
    if (!this.isInitialized) return;
    
    Object.keys(this.originalConsole).forEach(method => {
      console[method] = this.originalConsole[method];
    });
    
    this.isInitialized = false;
    this.originalConsole.log('[Analytics] Console interception disabled');
  }
}

// Export singleton instance
const consoleAnalyticsService = new ConsoleAnalyticsService();

/**
 * Initialize console analytics with PostHog
 * Call this early in your app lifecycle (App.js)
 */
export const initializeConsoleAnalytics = (posthogInstance) => {
  consoleAnalyticsService.init(posthogInstance);
};

export default consoleAnalyticsService;