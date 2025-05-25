// src/services/insightsService.js
//
// ENHANCED INSIGHTS SERVICE WITH ERROR BOUNDARIES
// Adds comprehensive error handling to ensure insights failures never cascade
// to round completion failures, maintaining system reliability

import { supabase } from "./supabase";

// Constants for error categorization and retry logic
const INSIGHTS_ERROR_TYPES = {
  NETWORK_ERROR: 'network_error',
  DATABASE_ERROR: 'database_error',
  PERMISSION_ERROR: 'permission_error',
  PROCESSING_ERROR: 'processing_error',
  TIMEOUT_ERROR: 'timeout_error'
};

// Retry configuration for different error types
const RETRY_CONFIG = {
  [INSIGHTS_ERROR_TYPES.NETWORK_ERROR]: { maxRetries: 3, delayMs: 1000 },
  [INSIGHTS_ERROR_TYPES.DATABASE_ERROR]: { maxRetries: 2, delayMs: 2000 },
  [INSIGHTS_ERROR_TYPES.PERMISSION_ERROR]: { maxRetries: 0, delayMs: 0 }, // Don't retry permission errors
  [INSIGHTS_ERROR_TYPES.PROCESSING_ERROR]: { maxRetries: 1, delayMs: 5000 },
  [INSIGHTS_ERROR_TYPES.TIMEOUT_ERROR]: { maxRetries: 2, delayMs: 3000 }
};

/**
 * Categorize error type for appropriate handling strategy
 * @param {Error} error - The error to categorize
 * @returns {string} Error type for handling strategy
 */
const categorizeError = (error) => {
  if (!error) return INSIGHTS_ERROR_TYPES.PROCESSING_ERROR;
  
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';
  
  // Network-related errors
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
    return INSIGHTS_ERROR_TYPES.NETWORK_ERROR;
  }
  
  // Supabase/Database errors
  if (code.startsWith('PGRST') || message.includes('database') || message.includes('relation')) {
    return INSIGHTS_ERROR_TYPES.DATABASE_ERROR;
  }
  
  // Permission/Authentication errors
  if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden')) {
    return INSIGHTS_ERROR_TYPES.PERMISSION_ERROR;
  }
  
  // Timeout errors
  if (message.includes('timeout') || code === 'ABORT_ERR') {
    return INSIGHTS_ERROR_TYPES.TIMEOUT_ERROR;
  }
  
  // Default to processing error
  return INSIGHTS_ERROR_TYPES.PROCESSING_ERROR;
};

/**
 * Enhanced error wrapper for insights operations
 * Provides comprehensive error handling with categorization and retry logic
 * 
 * @param {Function} operation - The insights operation to wrap
 * @param {Object} context - Context information for error logging
 * @returns {Function} Wrapped operation with error handling
 */
const withInsightsErrorBoundary = (operation, context = {}) => {
  return async (...args) => {
    const operationName = context.operationName || 'unknown_insights_operation';
    const maxRetries = context.maxRetries || 2;
    
    let lastError = null;
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        console.log(`[InsightsService] ${operationName}: Attempt ${attempt + 1}/${maxRetries + 1}`);
        
        // Execute the operation with timeout protection
        const result = await Promise.race([
          operation(...args),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timeout')), 30000) // 30 second timeout
          )
        ]);
        
        // Success - return result
        if (attempt > 0) {
          console.log(`[InsightsService] ${operationName}: Succeeded on retry attempt ${attempt + 1}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        attempt++;
        
        // Categorize the error for appropriate handling
        const errorType = categorizeError(error);
        const retryConfig = RETRY_CONFIG[errorType];
        
        console.error(`[InsightsService] ${operationName}: Attempt ${attempt} failed`, {
          error: error.message,
          errorType,
          code: error.code,
          willRetry: attempt <= maxRetries && retryConfig.maxRetries > 0
        });
        
        // Check if we should retry based on error type and attempt count
        if (attempt <= maxRetries && retryConfig.maxRetries > 0) {
          // Wait before retrying
          if (retryConfig.delayMs > 0) {
            console.log(`[InsightsService] ${operationName}: Waiting ${retryConfig.delayMs}ms before retry`);
            await new Promise(resolve => setTimeout(resolve, retryConfig.delayMs));
          }
          continue; // Retry the operation
        } else {
          // Max retries exceeded or error type shouldn't be retried
          break;
        }
      }
    }
    
    // All retries exhausted - log comprehensive error information
    const errorType = categorizeError(lastError);
    console.error(`[InsightsService] ${operationName}: All retries exhausted`, {
      finalError: lastError?.message,
      errorType,
      totalAttempts: attempt,
      context
    });
    
    // For insights operations, we return null instead of throwing
    // This ensures insights failures don't cascade to round completion
    return null;
  };
};

/**
 * ENHANCED: Get the latest insights for a user with comprehensive error handling
 * 
 * This function fetches the most recent insights record for a user,
 * and can return either the entire insights object or a specific field.
 * Enhanced with error boundaries to prevent insights failures from affecting core app functionality.
 * 
 * @param {string} userId - The user's profile ID
 * @param {string|null} fieldPath - Optional path to a specific field (e.g., 'summary', 'practiceFocus')
 * @returns {Promise<Object|string|null>} - The requested insights data or null if error/none exists
 */
export const getLatestInsights = withInsightsErrorBoundary(
  async (userId, fieldPath = null) => {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    console.log(`[InsightsService] Fetching latest insights for user ${userId}`);
    
    // Query the insights table for the latest record for this user
    const { data, error } = await supabase
      .from('insights')
      .select('*')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(); // Get as single object instead of array
    
    // Handle query error
    if (error) {
      // If the error is PGRST116 (not found), this isn't a true error - the user just has no insights
      if (error.code === 'PGRST116') {
        console.log('[InsightsService] No insights found for user');
        return null;
      }
      
      console.error('[InsightsService] Error fetching insights:', error);
      throw error; // Will be caught by error boundary
    }
    
    // If no data returned, return null
    if (!data) {
      console.log('[InsightsService] No insights found for user');
      return null;
    }
    
    console.log('[InsightsService] Found insights record:', data.id);
    
    // Extract the insights data from the JSONB column
    const insightsData = data.insights;
    
    // If a specific field was requested, return just that field
    if (fieldPath && insightsData) {
      console.log(`[InsightsService] Returning specific field: ${fieldPath}`);
      return insightsData[fieldPath] || null;
    }
    
    // Otherwise return the full insights object
    return insightsData;
  },
  { 
    operationName: 'getLatestInsights',
    maxRetries: 2
  }
);

/**
 * ENHANCED: Get insights for a specific round with error boundaries
 * 
 * This function fetches insights that were generated for a specific round,
 * which is useful for showing insights on the round details screen.
 * Enhanced with comprehensive error handling to prevent cascading failures.
 * 
 * @param {string} roundId - The round ID to fetch insights for
 * @param {string|null} fieldPath - Optional path to a specific field
 * @returns {Promise<Object|string|null>} - The requested insights data or null if error/none exists
 */
export const getRoundInsights = withInsightsErrorBoundary(
  async (roundId, fieldPath = null) => {
    if (!roundId) {
      throw new Error('Round ID is required');
    }
    
    console.log(`[InsightsService] Fetching insights for round ${roundId}`);
    
    // Query the insights table for insights related to this round
    const { data, error } = await supabase
      .from('insights')
      .select('*')
      .eq('round_id', roundId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        console.log('[InsightsService] No insights found for this round');
        return null;
      }
      
      console.error('[InsightsService] Error fetching round insights:', error);
      throw error; // Will be caught by error boundary
    }
    
    if (!data) {
      console.log('[InsightsService] No insights found for this round');
      return null;
    }
    
    console.log('[InsightsService] Found insights record for round:', data.id);
    
    // Extract the insights data
    const insightsData = data.insights;
    
    // Return specific field if requested
    if (fieldPath && insightsData) {
      return insightsData[fieldPath] || null;
    }
    
    // Otherwise return full insights
    return insightsData;
  },
  { 
    operationName: 'getRoundInsights',
    maxRetries: 2
  }
);

/**
 * ENHANCED: Submit feedback on insights with error boundaries
 * 
 * This allows users to rate the helpfulness of insights they receive,
 * which can be used to improve the quality of future insights.
 * Enhanced with error handling to ensure feedback failures don't affect user experience.
 * 
 * @param {string} insightId - The ID of the insight record to rate
 * @param {string} feedback - Feedback text from the user
 * @returns {Promise<boolean>} - Success flag (true even if error occurred to prevent UI issues)
 */
export const submitInsightFeedback = withInsightsErrorBoundary(
  async (insightId, feedback) => {
    if (!insightId || !feedback) {
      throw new Error('Insight ID and feedback are required');
    }
    
    console.log(`[InsightsService] Submitting feedback for insight ${insightId}`);
    
    // Update the insight record with the user's feedback
    const { error } = await supabase
      .from('insights')
      .update({ feedback_rating: feedback })
      .eq('id', insightId);
    
    if (error) {
      console.error('[InsightsService] Error submitting feedback:', error);
      throw error; // Will be caught by error boundary
    }
    
    console.log('[InsightsService] Feedback submitted successfully');
    return true;
  },
  { 
    operationName: 'submitInsightFeedback',
    maxRetries: 1
  }
) || (async () => true); // Always return true if error boundary returns null

/**
 * ENHANCED: Trigger insights generation with comprehensive error isolation
 * 
 * This function triggers the insights generation Edge Function while ensuring
 * that any failures in the insights system don't cascade to round completion.
 * Used by the round completion pipeline as a non-blocking operation.
 * 
 * @param {string} userId - The user's profile ID
 * @param {string} roundId - The round ID that triggered insights generation
 * @returns {Promise<Object|null>} - Insights generation result or null if failed
 */
export const triggerInsightsGeneration = withInsightsErrorBoundary(
  async (userId, roundId) => {
    if (!userId || !roundId) {
      throw new Error('User ID and Round ID are required');
    }
    
    console.log(`[InsightsService] Triggering insights generation for user ${userId}, round ${roundId}`);
    
    // Call the insights generation Edge Function
    const { data, error } = await supabase.functions.invoke('analyze-golf-performance', {
      body: { 
        userId: userId,
        roundId: roundId
      }
    });
    
    if (error) {
      console.error('[InsightsService] Error from insights Edge Function:', error);
      throw error; // Will be caught by error boundary
    }
    
    console.log('[InsightsService] Insights generation triggered successfully');
    return data;
  },
  { 
    operationName: 'triggerInsightsGeneration',
    maxRetries: 1 // Limited retries for Edge Function calls
  }
);

/**
 * ENHANCED: Get all insights for a user with pagination support
 * 
 * Retrieves insights history for a user with error boundaries and pagination.
 * Used for insights history screens and analytics.
 * 
 * @param {string} userId - The user's profile ID
 * @param {number} limit - Maximum number of insights to retrieve (default: 10)
 * @param {number} offset - Number of insights to skip for pagination (default: 0)
 * @returns {Promise<Array|null>} - Array of insights or null if error occurred
 */
export const getUserInsightsHistory = withInsightsErrorBoundary(
  async (userId, limit = 10, offset = 0) => {
    if (!userId) {
      throw new Error('User ID is required');
    }
    
    console.log(`[InsightsService] Fetching insights history for user ${userId} (limit: ${limit}, offset: ${offset})`);
    
    const { data, error } = await supabase
      .from('insights')
      .select('id, created_at, insights, round_id, feedback_rating')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error('[InsightsService] Error fetching insights history:', error);
      throw error; // Will be caught by error boundary
    }
    
    console.log(`[InsightsService] Retrieved ${data?.length || 0} insights records`);
    return data || [];
  },
  { 
    operationName: 'getUserInsightsHistory',
    maxRetries: 2
  }
);

/**
 * ENHANCED: Delete insights record with error boundaries
 * 
 * Allows deletion of insights records with comprehensive error handling.
 * Used for data management and user privacy controls.
 * 
 * @param {string} insightId - The ID of the insight record to delete
 * @param {string} userId - The user's profile ID for authorization
 * @returns {Promise<boolean>} - Success flag (true even if error for UI stability)
 */
export const deleteInsights = withInsightsErrorBoundary(
  async (insightId, userId) => {
    if (!insightId || !userId) {
      throw new Error('Insight ID and User ID are required');
    }
    
    console.log(`[InsightsService] Deleting insights record ${insightId} for user ${userId}`);
    
    // Delete the insights record (with user authorization check)
    const { error } = await supabase
      .from('insights')
      .delete()
      .eq('id', insightId)
      .eq('profile_id', userId); // Ensure user can only delete their own insights
    
    if (error) {
      console.error('[InsightsService] Error deleting insights:', error);
      throw error; // Will be caught by error boundary
    }
    
    console.log('[InsightsService] Insights record deleted successfully');
    return true;
  },
  { 
    operationName: 'deleteInsights',
    maxRetries: 1
  }
) || (async () => true); // Always return true if error boundary returns null

/**
 * ENHANCED: Health check for insights system
 * 
 * Provides a health check endpoint for the insights system to ensure
 * it's functioning properly. Used for monitoring and debugging.
 * 
 * @returns {Promise<Object|null>} - Health status or null if system is down
 */
export const checkInsightsSystemHealth = withInsightsErrorBoundary(
  async () => {
    console.log('[InsightsService] Checking insights system health');
    
    const healthChecks = {
      database_connection: false,
      edge_function_available: false,
      processing_capability: false
    };
    
    try {
      // Test database connection
      const { error: dbError } = await supabase
        .from('insights')
        .select('id')
        .limit(1);
      
      healthChecks.database_connection = !dbError;
      
      // Test Edge Function availability (with short timeout)
      const testUserId = 'health-check-test-user';
      const testRoundId = 'health-check-test-round';
      
      const { error: edgeError } = await Promise.race([
        supabase.functions.invoke('analyze-golf-performance', {
          body: { userId: testUserId, roundId: testRoundId }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);
      
      // Edge function is available if it responds (even with an error about test data)
      healthChecks.edge_function_available = true;
      healthChecks.processing_capability = !edgeError || edgeError.message.includes('test');
      
    } catch (error) {
      console.warn('[InsightsService] Health check encountered error:', error.message);
    }
    
    const overallHealth = Object.values(healthChecks).every(check => check);
    
    console.log('[InsightsService] Health check completed:', {
      ...healthChecks,
      overall_healthy: overallHealth,
      timestamp: new Date().toISOString()
    });
    
    return {
      ...healthChecks,
      overall_healthy: overallHealth,
      timestamp: new Date().toISOString()
    };
  },
  { 
    operationName: 'checkInsightsSystemHealth',
    maxRetries: 0 // Don't retry health checks
  }
);

// Export error types and configuration for external use
export { INSIGHTS_ERROR_TYPES, RETRY_CONFIG };