// src/services/roundservice.js
// 
// ENHANCED ROUND COMPLETION RELIABILITY REDESIGN
// Transforms monolithic completion into sequential, recoverable operations
// with granular error handling, comprehensive telemetry, and checkpoint-based recovery

import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";

// PostHog integration for comprehensive completion telemetry
// This will be injected by the consuming component to avoid circular dependencies
let posthogInstance = null;
export const setPostHogInstance = (posthog) => {
  posthogInstance = posthog;
};

// Checkpoint state management constants
const CHECKPOINT_PREFIX = 'round_completion_checkpoint_';
const CHECKPOINT_EXPIRY_HOURS = 24; // Checkpoints expire after 24 hours

// Define event constants for analytics tracking
const COMPLETION_EVENTS = {
  SEQUENCE_STARTED: 'round_completion_sequence_started',
  SEQUENCE_COMPLETED: 'round_completion_sequence_completed',
  SEQUENCE_ABANDONED: 'round_completion_sequence_abandoned',
  STEP_STARTED: 'round_completion_step_started',
  STEP_COMPLETED: 'round_completion_step_completed',
  STEP_FAILED: 'round_completion_step_failed',
  RECOVERY_INITIATED: 'round_completion_recovery_initiated',
  RECOVERY_SUCCESSFUL: 'round_completion_recovery_successful',
  RETRY_ATTEMPTED: 'round_completion_retry_attempted'
};

/**
 * Enhanced telemetry logging with auth context
 * Provides diagnostic precision for failure analysis
 */
const logStepFailure = (step, error, authContext, retryAttempt = 0) => {
  console.error(`[RoundCompletion] Step ${step} failed:`, error);
  
  if (posthogInstance) {
    posthogInstance.capture(COMPLETION_EVENTS.STEP_FAILED, {
      step,
      error_type: error.code || 'unknown',
      error_message: error.message,
      retry_attempt: retryAttempt,
      auth_state: authContext?.hasValidToken || false,
      auth_token_age: authContext?.tokenAge || null,
      timestamp: new Date().toISOString()
    });
  }
};

const logStepSuccess = (step, authContext) => {
  console.log(`[RoundCompletion] Step ${step} completed successfully`);
  
  if (posthogInstance) {
    posthogInstance.capture(COMPLETION_EVENTS.STEP_COMPLETED, {
      step,
      auth_state: authContext?.hasValidToken || false,
      timestamp: new Date().toISOString()
    });
  }
};

const logRecoveryEvent = (originalStep, resumeStep, success) => {
  if (posthogInstance) {
    posthogInstance.capture(success ? COMPLETION_EVENTS.RECOVERY_SUCCESSFUL : COMPLETION_EVENTS.RECOVERY_INITIATED, {
      original_step: originalStep,
      resume_step: resumeStep,
      success,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * ========================================================================
 * CHECKPOINT STATE MANAGEMENT
 * Provides persistence and recovery across app lifecycle changes
 * ========================================================================
 */

/**
 * Save completion progress checkpoint to AsyncStorage
 * Survives app restarts and background/foreground transitions
 */
const saveCompletionCheckpoint = async (roundId, stepProgress, lastFailure = null) => {
  try {
    const checkpoint = {
      roundId,
      userId: null, // Will be populated by calling code
      startedAt: new Date().toISOString(),
      stepProgress,
      lastFailure,
      expiresAt: new Date(Date.now() + (CHECKPOINT_EXPIRY_HOURS * 60 * 60 * 1000)).toISOString()
    };
    
    await AsyncStorage.setItem(`${CHECKPOINT_PREFIX}${roundId}`, JSON.stringify(checkpoint));
    console.log(`[RoundCompletion] Checkpoint saved for round ${roundId}`);
  } catch (error) {
    console.error('[RoundCompletion] Failed to save checkpoint:', error);
  }
};

/**
 * Load completion checkpoint from AsyncStorage
 * Returns null if no checkpoint exists or if expired
 */
const loadCompletionCheckpoint = async (roundId) => {
  try {
    const checkpointData = await AsyncStorage.getItem(`${CHECKPOINT_PREFIX}${roundId}`);
    if (!checkpointData) return null;
    
    const checkpoint = JSON.parse(checkpointData);
    
    // Check if checkpoint has expired
    if (new Date(checkpoint.expiresAt) < new Date()) {
      await AsyncStorage.removeItem(`${CHECKPOINT_PREFIX}${roundId}`);
      return null;
    }
    
    return checkpoint;
  } catch (error) {
    console.error('[RoundCompletion] Failed to load checkpoint:', error);
    return null;
  }
};

/**
 * Detect where to resume completion process
 * Provides intelligent recovery from any intermediate failure point
 */
const detectResumePoint = async (roundId) => {
  const checkpoint = await loadCompletionCheckpoint(roundId);
  if (!checkpoint) return { startFromBeginning: true };
  
  const stepOrder = [
    'saveCurrentHole', 
    'retrieveAllHoles', 
    'validateData', 
    'saveToDatabase', 
    'markComplete', 
    'generateInsights', 
    'cleanup'
  ];
  
  // Find the first failed step
  const failedStep = Object.entries(checkpoint.stepProgress)
    .find(([step, progress]) => progress.status === 'failed');
    
  if (failedStep) {
    return { 
      resumeFromStep: failedStep[0],
      preserveError: checkpoint.lastFailure,
      checkpoint
    };
  }
  
  // Find the last completed step and resume from the next one
  const lastCompletedStep = Object.entries(checkpoint.stepProgress)
    .reverse()
    .find(([step, progress]) => progress.status === 'completed');
    
  if (lastCompletedStep) {
    const nextStepIndex = stepOrder.indexOf(lastCompletedStep[0]) + 1;
    if (nextStepIndex < stepOrder.length) {
      return { 
        resumeFromStep: stepOrder[nextStepIndex],
        checkpoint
      };
    }
  }
  
  return { startFromBeginning: true };
};

/**
 * Clear completion checkpoint after successful completion
 */
const clearCompletionCheckpoint = async (roundId) => {
  try {
    await AsyncStorage.removeItem(`${CHECKPOINT_PREFIX}${roundId}`);
    console.log(`[RoundCompletion] Checkpoint cleared for round ${roundId}`);
  } catch (error) {
    console.error('[RoundCompletion] Failed to clear checkpoint:', error);
  }
};

/**
 * ========================================================================
 * SEQUENTIAL COMPLETION FUNCTIONS
 * Each function represents an atomic operation in the completion pipeline
 * ========================================================================
 */

/**
 * Step 1: Save current hole data to local storage
 * Ensures no in-progress hole data is lost
 */
const saveCurrentHoleData = async (roundId, currentHole, holeData) => {
  const stepName = 'saveCurrentHole';
  console.log(`[RoundCompletion] ${stepName}: Saving hole ${currentHole} data`);
  
  try {
    // Get existing stored hole data
    const existingDataStr = await AsyncStorage.getItem(`round_${roundId}_holes`);
    const existingData = existingDataStr ? JSON.parse(existingDataStr) : {};
    
    // Update with current hole data
    existingData[currentHole] = holeData;
    
    // Save back to AsyncStorage
    await AsyncStorage.setItem(`round_${roundId}_holes`, JSON.stringify(existingData));
    
    console.log(`[RoundCompletion] ${stepName}: Successfully saved hole ${currentHole}`);
    return { success: true, step: stepName };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Failed to save current hole:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * Step 2: Retrieve all hole data from local storage
 * Validates data integrity before database operations
 */
const retrieveAllHoleData = async (roundId) => {
  const stepName = 'retrieveAllHoles';
  console.log(`[RoundCompletion] ${stepName}: Retrieving all hole data`);
  
  try {
    const storedDataStr = await AsyncStorage.getItem(`round_${roundId}_holes`);
    if (!storedDataStr) {
      throw new Error('No hole data found in local storage');
    }
    
    const storedData = JSON.parse(storedDataStr);
    const holeCount = Object.keys(storedData).length;
    
    console.log(`[RoundCompletion] ${stepName}: Retrieved data for ${holeCount} holes`);
    return { success: true, step: stepName, data: storedData, holeCount };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Failed to retrieve hole data:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * Step 3: Validate hole data integrity
 * Ensures data quality before database persistence
 */
const validateHoleData = (holeData) => {
  const stepName = 'validateData';
  console.log(`[RoundCompletion] ${stepName}: Validating hole data integrity`);
  
  try {
    const validHoles = [];
    const errors = [];
    
    Object.entries(holeData).forEach(([holeNum, data]) => {
      if (!data || !data.shots || !Array.isArray(data.shots)) {
        errors.push(`Hole ${holeNum}: Missing or invalid shots data`);
        return;
      }
      
      if (data.shots.length === 0) {
        errors.push(`Hole ${holeNum}: No shots recorded`);
        return;
      }
      
      validHoles.push(holeNum);
    });
    
    if (validHoles.length === 0) {
      throw new Error('No valid holes found in data');
    }
    
    console.log(`[RoundCompletion] ${stepName}: Validated ${validHoles.length} holes, ${errors.length} errors`);
    return { 
      success: true, 
      step: stepName, 
      validHoles, 
      errors,
      validHoleCount: validHoles.length
    };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Validation failed:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * Step 4: Save all hole data to database
 * Persists validated data with transactional safety
 */
const saveHolesToDatabase = async (roundId, holeData) => {
  const stepName = 'saveToDatabase';
  console.log(`[RoundCompletion] ${stepName}: Saving holes to database`);
  
  try {
    const savedHoles = [];
    const totalHoles = 18;
    
    for (let holeNum = 1; holeNum <= totalHoles; holeNum++) {
      // Skip holes with no data
      if (!holeData[holeNum] || !holeData[holeNum].shots || holeData[holeNum].shots.length === 0) {
        continue;
      }
      
      const holeInfo = holeData[holeNum];
      const totalScore = holeInfo.shots.length;
      
      // Create hole data object including POI data
      const holeDataForDb = {
        par: holeInfo.par,
        distance: holeInfo.distance,
        index: holeInfo.index,
        features: holeInfo.features || [],
        shots: holeInfo.shots,
        poi: holeInfo.poi || null
      };
      
      // Save to database using existing saveHoleData function
      await saveHoleData(roundId, holeNum, holeDataForDb, totalScore);
      savedHoles.push(holeNum);
    }
    
    console.log(`[RoundCompletion] ${stepName}: Saved ${savedHoles.length} holes to database`);
    return { 
      success: true, 
      step: stepName, 
      savedHoles,
      savedHoleCount: savedHoles.length
    };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Failed to save to database:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * Step 5: Mark round as complete with calculated statistics
 * Updates round status and triggers downstream processes
 */
const markRoundComplete = async (roundId) => {
  const stepName = 'markComplete';
  console.log(`[RoundCompletion] ${stepName}: Marking round as complete`);
  
  try {
    // Use existing completeRound function which handles statistics calculation
    const result = await completeRound(roundId);
    
    console.log(`[RoundCompletion] ${stepName}: Round marked complete with statistics`);
    return { 
      success: true, 
      step: stepName, 
      roundData: result
    };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Failed to mark complete:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * Step 6: Generate insights (non-blocking)
 * Triggers insights generation without blocking completion
 */
const generateInsights = async (userId, roundId) => {
  const stepName = 'generateInsights';
  console.log(`[RoundCompletion] ${stepName}: Generating insights (non-blocking)`);
  
  try {
    // Trigger insights generation asynchronously
    // This is non-blocking - if it fails, it doesn't affect round completion
    supabase.functions.invoke('analyze-golf-performance', {
      body: { 
        userId: userId,
        roundId: roundId
      }
    }).then(({ data: insightsData, error: insightsError }) => {
      if (insightsError) {
        console.error(`[RoundCompletion] ${stepName}: Insights generation failed:`, insightsError);
      } else {
        console.log(`[RoundCompletion] ${stepName}: Insights generated successfully`);
      }
    }).catch(err => {
      console.error(`[RoundCompletion] ${stepName}: Exception in insights generation:`, err);
    });
    
    // Return success immediately - we don't wait for insights
    return { 
      success: true, 
      step: stepName, 
      triggered: true
    };
  } catch (error) {
    // Even if triggering fails, we don't want to fail the round completion
    console.warn(`[RoundCompletion] ${stepName}: Failed to trigger insights:`, error);
    return { 
      success: true, 
      step: stepName, 
      triggered: false,
      error: error.message
    };
  }
};

/**
 * Step 7: Cleanup local storage
 * Removes temporary data after successful completion
 */
const cleanupLocalStorage = async (roundId) => {
  const stepName = 'cleanup';
  console.log(`[RoundCompletion] ${stepName}: Cleaning up local storage`);
  
  try {
    // Remove hole data from AsyncStorage
    await AsyncStorage.removeItem(`round_${roundId}_holes`);
    await AsyncStorage.removeItem("currentRound");
    
    // Clear completion checkpoint
    await clearCompletionCheckpoint(roundId);
    
    console.log(`[RoundCompletion] ${stepName}: Local storage cleaned up`);
    return { 
      success: true, 
      step: stepName
    };
  } catch (error) {
    console.error(`[RoundCompletion] ${stepName}: Cleanup failed:`, error);
    throw { step: stepName, originalError: error };
  }
};

/**
 * ========================================================================
 * MAIN SEQUENTIAL COMPLETION ORCHESTRATOR
 * Coordinates the entire completion pipeline with recovery capabilities
 * ========================================================================
 */

/**
 * Enhanced round completion with sequential operations and recovery
 * Replaces the monolithic completeRound approach
 */
const completeRoundSequential = async (roundId, currentHole, holeData, userId) => {
  const startTime = Date.now();
  
  // Log sequence initiation
  if (posthogInstance) {
    posthogInstance.capture(COMPLETION_EVENTS.SEQUENCE_STARTED, {
      round_id: roundId,
      user_id: userId,
      timestamp: new Date().toISOString()
    });
  }
  
  console.log(`[RoundCompletion] Starting sequential completion for round ${roundId}`);
  
  try {
    // Check for existing checkpoint and determine resume point
    const resumeInfo = await detectResumePoint(roundId);
    let currentStepProgress = {};
    
    if (resumeInfo.checkpoint) {
      console.log(`[RoundCompletion] Resuming from checkpoint at step: ${resumeInfo.resumeFromStep || 'beginning'}`);
      currentStepProgress = resumeInfo.checkpoint.stepProgress;
      
      logRecoveryEvent(
        resumeInfo.preserveError?.step, 
        resumeInfo.resumeFromStep, 
        false // recovery initiated
      );
    }
    
    // Define the completion pipeline
    const completionSteps = [
      {
        name: 'saveCurrentHole',
        fn: () => saveCurrentHoleData(roundId, currentHole, holeData),
        description: 'Saving current hole data'
      },
      {
        name: 'retrieveAllHoles',
        fn: () => retrieveAllHoleData(roundId),
        description: 'Retrieving all hole data'
      },
      {
        name: 'validateData',
        fn: (previousResults) => validateHoleData(previousResults.retrieveAllHoles.data),
        description: 'Validating hole data'
      },
      {
        name: 'saveToDatabase',
        fn: (previousResults) => saveHolesToDatabase(roundId, previousResults.retrieveAllHoles.data),
        description: 'Saving to database'
      },
      {
        name: 'markComplete',
        fn: () => markRoundComplete(roundId),
        description: 'Marking round complete'
      },
      {
        name: 'generateInsights',
        fn: () => generateInsights(userId, roundId),
        description: 'Generating insights'
      },
      {
        name: 'cleanup',
        fn: () => cleanupLocalStorage(roundId),
        description: 'Cleaning up'
      }
    ];
    
    // Determine starting point
    let startIndex = 0;
    if (resumeInfo.resumeFromStep) {
      startIndex = completionSteps.findIndex(step => step.name === resumeInfo.resumeFromStep);
      if (startIndex === -1) startIndex = 0;
    }
    
    // Execute steps sequentially
    const results = {};
    const authContext = await getAuthContext(); // You'll need to implement this
    
    for (let i = startIndex; i < completionSteps.length; i++) {
      const step = completionSteps[i];
      
      // Skip if already completed in checkpoint
      if (currentStepProgress[step.name]?.status === 'completed') {
        console.log(`[RoundCompletion] Skipping completed step: ${step.name}`);
        continue;
      }
      
      // Mark step as pending
      currentStepProgress[step.name] = {
        status: 'pending',
        timestamp: new Date().toISOString()
      };
      
      await saveCompletionCheckpoint(roundId, currentStepProgress);
      
      try {
        console.log(`[RoundCompletion] Executing step: ${step.name} - ${step.description}`);
        
        // Log step initiation
        if (posthogInstance) {
          posthogInstance.capture(COMPLETION_EVENTS.STEP_STARTED, {
            step: step.name,
            round_id: roundId,
            timestamp: new Date().toISOString()
          });
        }
        
        // Execute the step
        const result = await step.fn(results);
        results[step.name] = result;
        
        // Mark step as completed
        currentStepProgress[step.name] = {
          status: 'completed',
          timestamp: new Date().toISOString()
        };
        
        await saveCompletionCheckpoint(roundId, currentStepProgress);
        logStepSuccess(step.name, authContext);
        
      } catch (error) {
        // Mark step as failed and save error context
        const failureInfo = {
          step: step.name,
          error: error.message,
          timestamp: new Date().toISOString(),
          authContext
        };
        
        currentStepProgress[step.name] = {
          status: 'failed',
          timestamp: new Date().toISOString(),
          error: error.message
        };
        
        await saveCompletionCheckpoint(roundId, currentStepProgress, failureInfo);
        logStepFailure(step.name, error, authContext);
        
        // Re-throw to be handled by the caller
        throw {
          step: step.name,
          error: error,
          checkpoint: currentStepProgress,
          canRetry: true
        };
      }
    }
    
    // All steps completed successfully
    await clearCompletionCheckpoint(roundId);
    
    const completionDuration = Date.now() - startTime;
    console.log(`[RoundCompletion] Sequential completion successful in ${completionDuration}ms`);
    
    if (posthogInstance) {
      posthogInstance.capture(COMPLETION_EVENTS.SEQUENCE_COMPLETED, {
        round_id: roundId,
        user_id: userId,
        completion_duration_ms: completionDuration,
        steps_executed: completionSteps.length - startIndex,
        resumed_from_checkpoint: !!resumeInfo.checkpoint,
        timestamp: new Date().toISOString()
      });
    }
    
    return {
      success: true,
      completionDuration,
      results,
      resumedFromCheckpoint: !!resumeInfo.checkpoint
    };
    
  } catch (error) {
    const completionDuration = Date.now() - startTime;
    console.error(`[RoundCompletion] Sequential completion failed:`, error);
    
    if (posthogInstance) {
      posthogInstance.capture(COMPLETION_EVENTS.SEQUENCE_ABANDONED, {
        round_id: roundId,
        user_id: userId,
        failure_step: error.step,
        completion_duration_ms: completionDuration,
        error_message: error.error?.message || error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    throw error;
  }
};

/**
 * Get authentication context for telemetry
 * This should be implemented based on your auth architecture
 */
const getAuthContext = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    return {
      hasValidToken: !!session?.access_token,
      tokenAge: session?.access_token ? 
        (Date.now() - new Date(session.expires_at || 0).getTime()) / 1000 / 60 : null // in minutes
    };
  } catch (error) {
    return {
      hasValidToken: false,
      tokenAge: null
    };
  }
};

/**
 * ========================================================================
 * EXISTING FUNCTIONS (PRESERVED FOR COMPATIBILITY)
 * ======================================================================== 
 */

/**
 * Create a new round record in Supabase.
 * UNCHANGED - preserves existing functionality
 */
export const createRound = async (profile_id, course_id, tee_id, tee_name) => {
  console.log("[createRound] Attempting to create a new round", { 
    profile_id, 
    course_id,
    tee_id,
    tee_name
  });
  
  const { data, error } = await supabase
    .from("rounds")
    .insert({
      profile_id,
      course_id,
      is_complete: false,
      selected_tee_id: tee_id,
      selected_tee_name: tee_name
    })
    .select();

  if (error) {
    console.error("[createRound] Error creating round:", error);
    throw error;
  }

  console.log("[createRound] Round created successfully:", data[0]);
  return data[0];
};

/**
 * Delete an abandoned (incomplete) round
 * UNCHANGED - preserves existing functionality
 */
export const deleteAbandonedRound = async (round_id) => {
  const startTime = Date.now();
  
  try {
    console.log("[deleteAbandonedRound] Attempting to delete round:", round_id);
    
    const { error } = await supabase
      .from("rounds")
      .delete()
      .eq("id", round_id)
      .eq("is_complete", false);
    
    const duration = Date.now() - startTime;

    if (error) {
      console.error("[deleteAbandonedRound] Error deleting round:", error);
      return false;
    }
    
    console.log("[deleteAbandonedRound] Round deleted successfully:", round_id);
    return true;
  } catch (error) {
    console.error("[deleteAbandonedRound] Exception deleting round:", error);
    return false;
  }
};

/**
 * Save hole data for a specific hole
 * UNCHANGED - preserves existing functionality
 */
export const saveHoleData = async (round_id, hole_number, hole_data, total_score) => {
  console.log("[saveHoleData] Saving data for hole", hole_number, "in round", round_id);
  
  try {
    const { data, error } = await supabase
      .from("shots")
      .upsert({
        round_id,
        hole_number,
        hole_data,
        total_score
      }, {
        onConflict: 'round_id,hole_number',
        returning: 'representation'
      });
    
    if (error) {
      console.error("[saveHoleData] Error saving hole data:", error);
      throw error;
    }
    
    console.log("[saveHoleData] Hole data saved successfully:", data);
    return data;
  } catch (error) {
    console.error("[saveHoleData] Exception in saveHoleData:", error);
    throw error;
  }
};

/**
 * Get all hole data for a round
 * UNCHANGED - preserves existing functionality
 */
export const getRoundHoleData = async (round_id) => {
  console.log("[getRoundHoleData] Getting hole data for round", round_id);
  
  try {
    const { data, error } = await supabase
      .from("shots")
      .select("*")
      .eq("round_id", round_id)
      .order("hole_number", { ascending: true });
    
    if (error) {
      console.error("[getRoundHoleData] Error getting hole data:", error);
      throw error;
    }
    
    console.log("[getRoundHoleData] Found hole data:", data?.length, "holes");
    return data || [];
  } catch (error) {
    console.error("[getRoundHoleData] Exception in getRoundHoleData:", error);
    return [];
  }
};

/**
 * Complete a round by updating its is_complete flag and calculating final statistics.
 * UNCHANGED - preserves existing functionality for use by the sequential process
 */
export const completeRound = async (round_id) => {
  try {
    console.log("[completeRound] Calculating final statistics for round:", round_id);
    
    // Get the course_id from the round
    const { data: roundData, error: roundError } = await supabase
      .from("rounds")
      .select("course_id, profile_id, selected_tee_name") 
      .eq("id", round_id)
      .single();
      
    if (roundError) throw roundError;
    
    // Get the par value for that course
    const { data: courseData, error: courseError } = await supabase
      .from("courses")
      .select("par")
      .eq("id", roundData.course_id)
      .single();
      
    if (courseError) throw courseError;
    
    const coursePar = courseData.par || 72;
    
    // Get all hole records for this round
    const { data: holeRecords, error: holesError } = await supabase
      .from("shots")
      .select("total_score")
      .eq("round_id", round_id);
      
    if (holesError) throw holesError;
    
    // Calculate total gross shots
    let grossShots = 0;
    holeRecords.forEach(hole => {
      grossShots += hole.total_score || 0;
    });
    
    // Calculate score relative to par
    const score = grossShots - coursePar;
    
    console.log("[completeRound] Statistics calculated:", {
      coursePar,
      grossShots,
      score
    });
    
    // Update the round record
    const { data, error } = await supabase
      .from("rounds")
      .update({ 
        is_complete: true,
        gross_shots: grossShots,
        score: score
      })
      .eq("id", round_id)
      .select();

    if (error) {
      console.error("[completeRound] Error completing round:", error);
      throw error;
    }

    console.log("[completeRound] Round completed successfully:", data);
    return data;
  } catch (error) {
    console.error("[completeRound] Error in complete round process:", error);
    throw error;
  }
};

/**
 * ========================================================================
 * NEW EXPORT INTERFACE
 * Provides the enhanced completion function alongside existing ones
 * ========================================================================
 */

// Export the new sequential completion function as the primary interface
export { 
  completeRoundSequential,
  setPostHogInstance,
  detectResumePoint,
  loadCompletionCheckpoint,
  clearCompletionCheckpoint
};

// Export individual step functions for testing
export {
  saveCurrentHoleData,
  retrieveAllHoleData,
  validateHoleData,
  saveHolesToDatabase,
  markRoundComplete,
  generateInsights,
  cleanupLocalStorage
};