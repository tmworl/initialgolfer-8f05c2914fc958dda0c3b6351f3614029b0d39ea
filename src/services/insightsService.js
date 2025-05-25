// src/services/insightsService.js
//
// FOCUSED ENHANCEMENT: Only adds error boundary wrapper to prevent insights failures 
// from cascading to round completion. All other functionality remains identical.

import { supabase } from "./supabase";

/**
 * Error boundary wrapper for insights operations
 * Ensures insights failures don't cascade to round completion
 * 
 * @param {Function} operation - The insights operation to wrap
 * @param {string} operationName - Name for logging
 * @returns {Function} Wrapped operation that returns null on error instead of throwing
 */
const withInsightsErrorBoundary = (operation, operationName = 'insights_operation') => {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      console.error(`[InsightsService] ${operationName} failed:`, error.message);
      // Return null instead of throwing to prevent cascading failures
      return null;
    }
  };
};

/**
 * Get the latest insights for a user
 * WRAPPED: Now returns null on error instead of throwing
 * 
 * @param {string} userId - The user's profile ID
 * @param {string|null} fieldPath - Optional path to a specific field (e.g., 'summary', 'practiceFocus')
 * @returns {Promise<Object|string|null>} - The requested insights data or null if none exists/error
 */
export const getLatestInsights = withInsightsErrorBoundary(
  async (userId, fieldPath = null) => {
    console.log(`[insightsService] Fetching latest insights for user ${userId}`);
    
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
        console.log('[insightsService] No insights found for user');
        return null;
      }
      
      console.error('[insightsService] Error fetching insights:', error);
      throw error;
    }
    
    // If no data returned, return null
    if (!data) {
      console.log('[insightsService] No insights found for user');
      return null;
    }
    
    console.log('[insightsService] Found insights record:', data.id);
    
    // Extract the insights data from the JSONB column
    const insightsData = data.insights;
    
    // If a specific field was requested, return just that field
    if (fieldPath && insightsData) {
      console.log(`[insightsService] Returning specific field: ${fieldPath}`);
      return insightsData[fieldPath] || null;
    }
    
    // Otherwise return the full insights object
    return insightsData;
  },
  'getLatestInsights'
);

/**
 * Get insights for a specific round
 * WRAPPED: Now returns null on error instead of throwing
 * 
 * @param {string} roundId - The round ID to fetch insights for
 * @param {string|null} fieldPath - Optional path to a specific field
 * @returns {Promise<Object|string|null>} - The requested insights data or null if none exists/error
 */
export const getRoundInsights = withInsightsErrorBoundary(
  async (roundId, fieldPath = null) => {
    console.log(`[insightsService] Fetching insights for round ${roundId}`);
    
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
        console.log('[insightsService] No insights found for this round');
        return null;
      }
      
      console.error('[insightsService] Error fetching round insights:', error);
      throw error;
    }
    
    if (!data) {
      console.log('[insightsService] No insights found for this round');
      return null;
    }
    
    console.log('[insightsService] Found insights record for round:', data.id);
    
    // Extract the insights data
    const insightsData = data.insights;
    
    // Return specific field if requested
    if (fieldPath && insightsData) {
      return insightsData[fieldPath] || null;
    }
    
    // Otherwise return full insights
    return insightsData;
  },
  'getRoundInsights'
);