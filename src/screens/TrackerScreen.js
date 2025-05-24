// src/screens/TrackerScreen.js

import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { 
  View, 
  StyleSheet, 
  Alert, 
  ActivityIndicator, 
  ScrollView, 
  SafeAreaView,
  BackHandler,
  TouchableOpacity
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from '@react-navigation/native';
import { usePostHog } from 'posthog-react-native';
import Layout from "../ui/Layout";
import theme from "../ui/theme";
import { createRound, saveHoleData, completeRound, deleteAbandonedRound } from "../services/roundservice";
import ShotTable from "../components/ShotTable";
import HoleNavigator from "../components/HoleNavigator";
import { AuthContext } from "../context/AuthContext";
import Typography from "../ui/components/Typography";
import Button from "../ui/components/Button";
import DistanceIndicator from '../components/DistanceIndicator';

/**
 * TrackerScreen Component
 * 
 * This screen allows users to track shots during a round of golf.
 * Uses the new data structure for tracking and saving hole data.
 * Enhanced to include POI data for each hole when available.
 * 
 * Enhanced with proper iOS and Android exit handling that deletes abandoned rounds.
 * 
 * ANALYTICS: Decoupled architecture - analytics captured via useEffect monitoring
 * rather than inline within state update callbacks to prevent React state conflicts.
 */
export default function TrackerScreen({ navigation }) {
  // Get the authenticated user from context
  const { user } = useContext(AuthContext);
  
  // PostHog analytics hook
  const posthog = usePostHog();
  
  // Local state for tracking current hole and shots
  const [currentHole, setCurrentHole] = useState(1);
  const [totalHoles] = useState(18); // Standard golf round is 18 holes
  
  // Initialize hole data structure for all holes
  const initialHoleState = {};
  for (let i = 1; i <= 18; i++) {
    initialHoleState[i] = {
      // Hole characteristics (will be filled from course data)
      par: null,
      distance: null,
      index: null,
      features: [],
      
      // Shot data
      shots: [], // Array of { type, result, timestamp }
      
      // Shot counts for ShotTable compatibility
      shotCounts: {
        "Tee Shot": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Long Shot": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Approach": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Chip": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Putts": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Sand": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Penalties": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 }
      },
      
      // POI data for this hole
      poi: null
    };
  }
  
  // Main state variables for the component
  const [holeData, setHoleData] = useState(initialHoleState); // Tracks all data for all holes
  const [round, setRound] = useState(null);                    // Current round data
  const [activeColumn, setActiveColumn] = useState("On Target"); // Currently selected outcome column
  const [loading, setLoading] = useState(false);                // Loading state for async operations
  const [course, setCourse] = useState(null);                   // Current course data
  const [courseDetails, setCourseDetails] = useState(null);     // Detailed course data from database

  // Analytics tracking references
  const screenEntryTimeRef = useRef(Date.now());
  const roundStartTimeRef = useRef(null);
  const holeStartTimesRef = useRef({});
  const roundCompletionStartRef = useRef(null);
  
  // Analytics monitoring references - for decoupled event tracking
  const previousShotCountsRef = useRef({});
  const lastShotActionRef = useRef(null);

  // Analytics: Track screen entry and round initialization
  useEffect(() => {
    if (posthog && user) {
      posthog.capture('tracker_screen_entered', {
        profile_id: user.id,
        timestamp: new Date().toISOString(),
        entry_time: screenEntryTimeRef.current
      });
    }
  }, [posthog, user]);

  // DECOUPLED ANALYTICS: Monitor shot changes via useEffect
  useEffect(() => {
    // Skip analytics on initial render or if no round data
    if (!round || !user || !posthog) return;
    
    const currentHoleShots = holeData[currentHole]?.shots || [];
    const previousHoleShots = previousShotCountsRef.current[currentHole] || [];
    
    // Detect shot addition
    if (currentHoleShots.length > previousHoleShots.length) {
      const newShot = currentHoleShots[currentHoleShots.length - 1];
      
      posthog.capture('shot_recorded', {
        profile_id: user.id,
        round_id: round.id,
        course_id: round.course_id,
        hole_number: currentHole,
        shot_type: newShot.type,
        shot_outcome: newShot.result,
        hole_par: holeData[currentHole]?.par,
        current_hole_shots: currentHoleShots.length,
        timestamp: new Date().toISOString()
      });
    }
    
    // Detect shot removal
    if (currentHoleShots.length < previousHoleShots.length) {
      // Find which shot type/outcome was reduced
      const currentCounts = {};
      const previousCounts = {};
      
      // Count current shots by type and outcome
      currentHoleShots.forEach(shot => {
        const key = `${shot.type}_${shot.result}`;
        currentCounts[key] = (currentCounts[key] || 0) + 1;
      });
      
      // Count previous shots by type and outcome
      previousHoleShots.forEach(shot => {
        const key = `${shot.type}_${shot.result}`;
        previousCounts[key] = (previousCounts[key] || 0) + 1;
      });
      
      // Find the removed shot type/outcome
      Object.keys(previousCounts).forEach(key => {
        const [shotType, shotOutcome] = key.split('_');
        const currentCount = currentCounts[key] || 0;
        const previousCount = previousCounts[key] || 0;
        
        if (currentCount < previousCount) {
          posthog.capture('shot_removed', {
            profile_id: user.id,
            round_id: round.id,
            course_id: round.course_id,
            hole_number: currentHole,
            shot_type: shotType,
            shot_outcome: shotOutcome,
            remaining_shots: currentCount,
            timestamp: new Date().toISOString()
          });
        }
      });
    }
    
    // Update reference for next comparison
    previousShotCountsRef.current = {
      ...previousShotCountsRef.current,
      [currentHole]: [...currentHoleShots]
    };
    
  }, [holeData, currentHole, round, user, posthog]);

  // iOS Navigation Interception - Enhanced with delete logic and analytics
  useFocusEffect(
    useCallback(() => {
      const unsubscribe = navigation.addListener('beforeRemove', (e) => {
        if (round && round.id) {
          e.preventDefault();
          
          Alert.alert(
            "Exit Round?",
            "Are you sure you want to exit this round? Your progress will not be saved.",
            [
              { text: "Stay", style: "cancel" },
              { 
                text: "Exit", 
                style: "destructive",
                onPress: async () => {
                  try {
                    setLoading(true);
                    
                    // Analytics: Track round abandonment start
                    const abandonmentStart = Date.now();
                    if (posthog && user) {
                      posthog.capture('round_abandonment_started', {
                        profile_id: user.id,
                        round_id: round.id,
                        course_id: round.course_id,
                        current_hole: currentHole,
                        shots_recorded: getTotalShotsRecorded(),
                        abandonment_trigger: 'navigation_back',
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    // Analytics: Track database deletion checkpoint
                    if (posthog && user) {
                      posthog.capture('round_abandonment_checkpoint', {
                        profile_id: user.id,
                        round_id: round.id,
                        checkpoint: 'database_deletion_started',
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    await deleteAbandonedRound(round.id);
                    
                    // Analytics: Track storage cleanup checkpoint
                    if (posthog && user) {
                      posthog.capture('round_abandonment_checkpoint', {
                        profile_id: user.id,
                        round_id: round.id,
                        checkpoint: 'storage_cleanup_started',
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    await AsyncStorage.removeItem(`round_${round.id}_holes`);
                    await AsyncStorage.removeItem("currentRound");
                    
                    // Analytics: Track successful abandonment
                    const abandonmentDuration = Date.now() - abandonmentStart;
                    if (posthog && user) {
                      posthog.capture('round_abandonment_completed', {
                        profile_id: user.id,
                        round_id: round.id,
                        course_id: round.course_id,
                        abandonment_duration_ms: abandonmentDuration,
                        data_availability: true,
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    navigation.dispatch(e.data.action);
                  } catch (error) {
                    console.error("Error abandoning round:", error);
                    
                    // Analytics: Track abandonment error
                    if (posthog && user) {
                      posthog.capture('round_abandonment_error', {
                        profile_id: user.id,
                        round_id: round.id,
                        error_message: error.message,
                        data_availability: false,
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    navigation.dispatch(e.data.action);
                  } finally {
                    setLoading(false);
                  }
                }
              }
            ]
          );
        }
      });
      return unsubscribe;
    }, [navigation, round, setLoading, posthog, user, currentHole])
  );

  // Android Hardware Back Button Handler - Enhanced with delete logic and analytics
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (round && round.id) {
          Alert.alert(
            "Exit Round?",
            "Are you sure you want to exit this round? Your progress will not be saved.",
            [
              { text: "Stay", style: "cancel", onPress: () => {} },
              { 
                text: "Exit", 
                style: "destructive",
                onPress: async () => {
                  try {
                    setLoading(true);
                    
                    // Analytics: Track Android back button abandonment
                    if (posthog && user) {
                      posthog.capture('round_abandonment_started', {
                        profile_id: user.id,
                        round_id: round.id,
                        course_id: round.course_id,
                        current_hole: currentHole,
                        shots_recorded: getTotalShotsRecorded(),
                        abandonment_trigger: 'android_back_button',
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    await deleteAbandonedRound(round.id);
                    await AsyncStorage.removeItem(`round_${round.id}_holes`);
                    await AsyncStorage.removeItem("currentRound");
                    
                    // Analytics: Track successful Android abandonment
                    if (posthog && user) {
                      posthog.capture('round_abandonment_completed', {
                        profile_id: user.id,
                        round_id: round.id,
                        course_id: round.course_id,
                        abandonment_trigger: 'android_back_button',
                        data_availability: true,
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    navigation.goBack();
                  } catch (error) {
                    console.error("Error abandoning round:", error);
                    
                    // Analytics: Track Android abandonment error
                    if (posthog && user) {
                      posthog.capture('round_abandonment_error', {
                        profile_id: user.id,
                        round_id: round.id,
                        error_message: error.message,
                        abandonment_trigger: 'android_back_button',
                        data_availability: false,
                        timestamp: new Date().toISOString()
                      });
                    }
                    
                    navigation.goBack();
                  } finally {
                    setLoading(false);
                  }
                }
              }
            ]
          );
          return true;
        }
        return false;
      }
    );

    return () => backHandler.remove();
  }, [round, navigation, setLoading, posthog, user, currentHole]);

  // Helper function to get total shots recorded across all holes
  const getTotalShotsRecorded = useCallback(() => {
    let totalShots = 0;
    Object.keys(holeData).forEach(holeNum => {
      if (holeData[holeNum].shots) {
        totalShots += holeData[holeNum].shots.length;
      }
    });
    return totalShots;
  }, [holeData]);

  /**
   * Save the current hole data to AsyncStorage
   * Now includes POI data within the hole data structure
   * Analytics: Track data persistence operations
   */
  const saveCurrentHoleToStorage = useCallback(async () => {
    if (!round) return;
    
    try {
      // Analytics: Track hole data save start
      const saveStart = Date.now();
      if (posthog && user) {
        posthog.capture('hole_data_save_started', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          shots_count: holeData[currentHole]?.shots?.length || 0,
          timestamp: new Date().toISOString()
        });
      }
      
      // Get existing stored hole data or initialize empty object
      const existingDataStr = await AsyncStorage.getItem(`round_${round.id}_holes`);
      const existingData = existingDataStr ? JSON.parse(existingDataStr) : {};
      
      // Update with current hole data - POI data is now included in holeData
      existingData[currentHole] = holeData[currentHole];
      
      // Save back to AsyncStorage
      await AsyncStorage.setItem(`round_${round.id}_holes`, JSON.stringify(existingData));
      console.log(`Saved hole ${currentHole} data to AsyncStorage`);
      
      // Analytics: Track successful hole data save
      const saveDuration = Date.now() - saveStart;
      if (posthog && user) {
        posthog.capture('hole_data_save_success', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          shots_count: holeData[currentHole]?.shots?.length || 0,
          save_duration_ms: saveDuration,
          data_size: JSON.stringify(existingData).length,
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error saving hole data to AsyncStorage:", error);
      
      // Analytics: Track hole data save error
      if (posthog && user) {
        posthog.capture('hole_data_save_error', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          error_message: error.message,
          data_availability: false,
          timestamp: new Date().toISOString()
        });
      }
    }
  }, [round, currentHole, holeData, posthog, user]);

  /**
   * Load hole data from AsyncStorage
   * Will now include POI data if it was previously saved
   * Analytics: Track data loading operations
   */
  const loadHoleDataFromStorage = useCallback(async () => {
    if (!round) return;
    
    try {
      // Analytics: Track hole data load start
      if (posthog && user) {
        posthog.capture('hole_data_load_started', {
          profile_id: user.id,
          round_id: round.id,
          timestamp: new Date().toISOString()
        });
      }
      
      const storedDataStr = await AsyncStorage.getItem(`round_${round.id}_holes`);
      if (storedDataStr) {
        const storedData = JSON.parse(storedDataStr);
        
        // Merge with current state (only update holes that have stored data)
        setHoleData(prevData => {
          const newData = { ...prevData };
          
          // For each hole in stored data, update the state
          Object.keys(storedData).forEach(holeNum => {
            newData[holeNum] = storedData[holeNum];
          });
          
          return newData;
        });
        
        console.log("Loaded hole data from AsyncStorage");
        
        // Analytics: Track successful hole data load
        if (posthog && user) {
          posthog.capture('hole_data_load_success', {
            profile_id: user.id,
            round_id: round.id,
            holes_loaded: Object.keys(storedData).length,
            data_size: storedDataStr.length,
            data_availability: true,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error("Error loading hole data from AsyncStorage:", error);
      
      // Analytics: Track hole data load error
      if (posthog && user) {
        posthog.capture('hole_data_load_error', {
          profile_id: user.id,
          round_id: round.id,
          error_message: error.message,
          data_availability: false,
          timestamp: new Date().toISOString()
        });
      }
    }
  }, [round, posthog, user]);

  /**
   * Function to navigate to the next hole
   * Saves current hole data before moving
   * Analytics: Track hole navigation and completion
   */
  const handleNextHole = useCallback(async () => {
    if (currentHole < totalHoles) {
      // Analytics: Track hole completion
      const holeStartTime = holeStartTimesRef.current[currentHole];
      const holeDuration = holeStartTime ? Date.now() - holeStartTime : null;
      const shotsOnHole = holeData[currentHole]?.shots?.length || 0;
      
      if (posthog && user && round) {
        posthog.capture('hole_completed', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          hole_number: currentHole,
          shots_count: shotsOnHole,
          hole_duration_ms: holeDuration,
          hole_par: holeData[currentHole]?.par,
          timestamp: new Date().toISOString()
        });
      }
      
      // Save current hole data to AsyncStorage
      await saveCurrentHoleToStorage();
      
      // Move to the next hole
      setCurrentHole(prev => {
        const nextHole = prev + 1;
        // Set start time for next hole
        holeStartTimesRef.current[nextHole] = Date.now();
        
        // Analytics: Track hole navigation
        if (posthog && user && round) {
          posthog.capture('hole_navigation', {
            profile_id: user.id,
            round_id: round.id,
            from_hole: prev,
            to_hole: nextHole,
            direction: 'next',
            timestamp: new Date().toISOString()
          });
        }
        
        return nextHole;
      });
    } else {
      // If on the last hole, prompt to finish the round
      Alert.alert(
        "End of Round",
        "You've reached the last hole. Would you like to finish the round?",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Finish Round", 
            onPress: () => {
              // Analytics: Track round finish prompt
              if (posthog && user && round) {
                posthog.capture('round_finish_prompt_accepted', {
                  profile_id: user.id,
                  round_id: round.id,
                  total_shots: getTotalShotsRecorded(),
                  timestamp: new Date().toISOString()
                });
              }
              finishRound();
            },
            style: "default" 
          }
        ]
      );
    }
  }, [currentHole, totalHoles, saveCurrentHoleToStorage, posthog, user, round, holeData, getTotalShotsRecorded]);

  /**
   * Function to navigate to the previous hole
   * Saves current hole data before moving
   * Analytics: Track hole navigation
   */
  const handlePreviousHole = useCallback(async () => {
    if (currentHole > 1) {
      // Save current hole data to AsyncStorage
      await saveCurrentHoleToStorage();
      
      // Move to the previous hole
      setCurrentHole(prev => {
        const prevHole = prev - 1;
        
        // Analytics: Track hole navigation
        if (posthog && user && round) {
          posthog.capture('hole_navigation', {
            profile_id: user.id,
            round_id: round.id,
            from_hole: prev,
            to_hole: prevHole,
            direction: 'previous',
            timestamp: new Date().toISOString()
          });
        }
        
        return prevHole;
      });
    }
  }, [currentHole, saveCurrentHoleToStorage, posthog, user, round]);

  /**
   * Update hole information when courseDetails or currentHole changes
   * Now includes mapping POI data for the current hole
   */
  useEffect(() => {
    // Update hole information when courseDetails is available
    if (courseDetails && courseDetails.holes) {
      // Find information for the current hole
      const currentHoleInfo = courseDetails.holes.find(
        hole => hole.number === currentHole
      );
      
      if (currentHoleInfo) {
        // Get selected tee information
        const selectedTeeName = round?.selected_tee_name?.toLowerCase() || course?.teeName?.toLowerCase();
        
        // Get distance for selected tee
        let distance = null;
        if (currentHoleInfo.distances && selectedTeeName && currentHoleInfo.distances[selectedTeeName]) {
          distance = currentHoleInfo.distances[selectedTeeName];
        } else if (currentHoleInfo.distances) {
          // Fallback to first available tee
          const firstTee = Object.keys(currentHoleInfo.distances)[0];
          if (firstTee) {
            distance = currentHoleInfo.distances[firstTee];
          }
        }
        
        // Find POI data for the current hole if available
        let holePoi = null;
        if (course && course.poi && Array.isArray(course.poi)) {
          // Find POI data for this specific hole
          const holePoiData = course.poi.find(poi => poi.hole === currentHole);
          if (holePoiData) {
            holePoi = {
              greens: holePoiData.greens || [],
              bunkers: holePoiData.bunkers || [],
              hazards: holePoiData.hazards || [],
              tees: holePoiData.tees || []
            };
          }
        }
        
        // Update hole data with course information
        setHoleData(prevData => {
          const newData = { ...prevData };
          
          // Only update if not already set
          if (!newData[currentHole].par) {
            newData[currentHole] = {
              ...newData[currentHole],
              par: currentHoleInfo.par_men || null,
              distance: distance || null,
              index: currentHoleInfo.index_men || null,
              features: currentHoleInfo.features || [],
              poi: holePoi // Add POI data to hole
            };
            
            // Analytics: Track hole data update
            if (posthog && user && round) {
              posthog.capture('hole_data_updated', {
                profile_id: user.id,
                round_id: round.id,
                hole_number: currentHole,
                hole_par: currentHoleInfo.par_men,
                hole_distance: distance,
                has_poi_data: !!holePoi,
                data_availability: !!(currentHoleInfo.par_men && distance),
                timestamp: new Date().toISOString()
              });
            }
          }
          
          return newData;
        });
      }
    }
  }, [courseDetails, currentHole, round, course, posthog, user]);

  /**
   * Initialize round on component mount
   * Enhanced to handle POI data from selected course
   * Analytics: Comprehensive round initialization tracking
   */
  useEffect(() => {
    const initializeRound = async () => {
      try {
        if (!user) {
          console.warn("No user found. Cannot create a round without a signed-in user.");
          return;
        }
        
        // Analytics: Track round initialization start
        roundStartTimeRef.current = Date.now();
        if (posthog) {
          posthog.capture('round_initialization_started', {
            profile_id: user.id,
            timestamp: new Date().toISOString()
          });
        }
        
        // Get the selected course data from AsyncStorage
        const storedCourseData = await AsyncStorage.getItem("selectedCourse");
        if (!storedCourseData) {
          console.error("No course selected. Cannot start a round.");
          
          // Analytics: Track missing course data error
          if (posthog && user) {
            posthog.capture('round_initialization_error', {
              profile_id: user.id,
              error_type: 'no_course_selected',
              data_availability: false,
              timestamp: new Date().toISOString()
            });
          }
          
          navigation.goBack();
          return;
        }
        
        const courseData = JSON.parse(storedCourseData);
        setCourse(courseData);
        
        console.log("Starting round with course and tee:", courseData);
        
        // Log POI availability for debugging
        if (courseData.poi && Array.isArray(courseData.poi)) {
          console.log(`Course has POI data for ${courseData.poi.length} holes`);
        } else {
          console.log("Course does not have POI data");
        }
        
        // Analytics: Track course data validation
        if (posthog && user) {
          posthog.capture('round_initialization_checkpoint', {
            profile_id: user.id,
            checkpoint: 'course_data_loaded',
            course_id: courseData.id,
            course_name: courseData.name,
            tee_name: courseData.teeName,
            has_poi_data: !!(courseData.poi?.length),
            poi_count: courseData.poi?.length || 0,
            data_availability: true,
            timestamp: new Date().toISOString()
          });
        }
        
        // Check if there's an in-progress round in AsyncStorage
        const existingRoundStr = await AsyncStorage.getItem("currentRound");
        let roundData;
        
        if (existingRoundStr) {
          // Use existing round
          roundData = JSON.parse(existingRoundStr);
          console.log("Resuming existing round:", roundData);
          setRound(roundData);
          
          // Analytics: Track round resumption
          if (posthog && user) {
            posthog.capture('round_resumed', {
              profile_id: user.id,
              round_id: roundData.id,
              course_id: roundData.course_id,
              timestamp: new Date().toISOString()
            });
          }
        } else {
          // Create a new round
          // Analytics: Track round creation start
          if (posthog && user) {
            posthog.capture('round_initialization_checkpoint', {
              profile_id: user.id,
              checkpoint: 'round_creation_started',
              course_id: courseData.id,
              timestamp: new Date().toISOString()
            });
          }
          
          roundData = await createRound(
            user.id,
            courseData.id,
            courseData.teeId,
            courseData.teeName
          );
          
          console.log("New round created:", roundData);
          setRound(roundData);
          
          // Store the round in AsyncStorage
          await AsyncStorage.setItem("currentRound", JSON.stringify(roundData));
          
          // Analytics: Track successful round creation
          if (posthog && user) {
            posthog.capture('round_created', {
              profile_id: user.id,
              round_id: roundData.id,
              course_id: roundData.course_id,
              selected_tee_id: roundData.selected_tee_id,
              selected_tee_name: roundData.selected_tee_name,
              data_availability: true,
              timestamp: new Date().toISOString()
            });
          }
        }
        
        // Get supabase from the service
        const { supabase } = require("../services/supabase");
        
        // Get full course details from database
        try {
          // Analytics: Track course details fetch start
          if (posthog && user) {
            posthog.capture('round_initialization_checkpoint', {
              profile_id: user.id,
              checkpoint: 'course_details_fetch_started',
              course_id: courseData.id,
              timestamp: new Date().toISOString()
            });
          }
          
          const { data: fullCourseData, error } = await supabase
            .from("courses")
            .select("*")
            .eq("id", courseData.id)
            .single();
            
          if (error) {
            console.error("Error fetching course details:", error);
            
            // Analytics: Track course details fetch error
            if (posthog && user) {
              posthog.capture('round_initialization_error', {
                profile_id: user.id,
                error_type: 'course_details_fetch_failed',
                course_id: courseData.id,
                error_message: error.message,
                data_availability: false,
                timestamp: new Date().toISOString()
              });
            }
          } else if (fullCourseData) {
            console.log("Found full course details:", fullCourseData.name);
            setCourseDetails(fullCourseData);
            
            // Analytics: Track successful course details fetch
            if (posthog && user) {
              posthog.capture('round_initialization_checkpoint', {
                profile_id: user.id,
                checkpoint: 'course_details_loaded',
                course_id: courseData.id,
                course_holes_count: fullCourseData.holes?.length || 0,
                course_par: fullCourseData.par,
                data_availability: true,
                timestamp: new Date().toISOString()
              });
            }
          }
        } catch (error) {
          console.error("Error fetching course details:", error);
          
          // Analytics: Track course details fetch exception
          if (posthog && user) {
            posthog.capture('round_initialization_error', {
              profile_id: user.id,
              error_type: 'course_details_fetch_exception',
              course_id: courseData.id,
              error_message: error.message,
              data_availability: false,
              timestamp: new Date().toISOString()
            });
          }
        }
        
        // Load any existing hole data from AsyncStorage
        if (roundData) {
          await loadHoleDataFromStorage();
        }
        
        // Set start time for first hole
        holeStartTimesRef.current[1] = Date.now();
        
        // Analytics: Track successful round initialization
        const initializationDuration = Date.now() - roundStartTimeRef.current;
        if (posthog && user) {
          posthog.capture('round_initialization_completed', {
            profile_id: user.id,
            round_id: roundData.id,
            course_id: roundData.course_id,
            initialization_duration_ms: initializationDuration,
            data_availability: true,
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error("Error initializing round:", error);
        Alert.alert(
          "Error",
          "There was a problem starting your round. Please try again."
        );
        
        // Analytics: Track round initialization error
        if (posthog && user) {
          posthog.capture('round_initialization_error', {
            profile_id: user.id,
            error_type: 'general_initialization_error',
            error_message: error.message,
            data_availability: false,
            timestamp: new Date().toISOString()
          });
        }
      }
    };
    
    initializeRound();
  }, [user, navigation, posthog, loadHoleDataFromStorage]);

  /**
   * PURE STATE UPDATE: Function to add a shot of a specific type and outcome
   * Analytics removed from this callback - now handled by useEffect monitoring
   */
  const addShot = useCallback((type, outcome) => {
    console.log(`Adding ${outcome} ${type} shot for hole ${currentHole}`);
    
    setHoleData(prevData => {
      const newData = { ...prevData };
      const currentHoleInfo = { ...newData[currentHole] };
      
      // Add to shots array
      currentHoleInfo.shots.push({
        type,
        result: outcome,
        timestamp: new Date().toISOString()
      });
      
      // Update shot counts for ShotTable compatibility
      currentHoleInfo.shotCounts[type][outcome] += 1;
      
      // Update hole data
      newData[currentHole] = currentHoleInfo;
      
      return newData;
    });
  }, [currentHole]);

  /**
   * PURE STATE UPDATE: Function to remove a shot of a specific type and outcome
   * Analytics removed from this callback - now handled by useEffect monitoring
   */
  const removeShot = useCallback((type, outcome) => {
    console.log(`Removing ${outcome} ${type} shot for hole ${currentHole}`);
    
    setHoleData(prevData => {
      const newData = { ...prevData };
      const currentHoleInfo = { ...newData[currentHole] };
      
      // Only proceed if there are shots to remove
      if (currentHoleInfo.shotCounts[type][outcome] <= 0) {
        return prevData;
      }
      
      // Find the index of the last shot of this type and outcome
      const shotIndex = [...currentHoleInfo.shots].reverse().findIndex(
        shot => shot.type === type && shot.result === outcome
      );
      
      if (shotIndex !== -1) {
        // Convert the reversed index to the actual index
        const actualIndex = currentHoleInfo.shots.length - 1 - shotIndex;
        
        // Remove the shot from the shots array
        currentHoleInfo.shots.splice(actualIndex, 1);
        
        // Update the shot counts for ShotTable compatibility
        currentHoleInfo.shotCounts[type][outcome] -= 1;
        
        // Update the hole data
        newData[currentHole] = currentHoleInfo;
      }
      
      return newData;
    });
  }, [currentHole]);

  /**
   * Complete a hole and save data to AsyncStorage
   * Analytics: Track hole completion process
   */
  const completeHole = async () => {
    try {
      setLoading(true);
      
      // Analytics: Track hole completion start
      if (posthog && user && round) {
        posthog.capture('hole_completion_started', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          shots_count: holeData[currentHole]?.shots?.length || 0,
          timestamp: new Date().toISOString()
        });
      }
      
      // Save current hole data to AsyncStorage
      await saveCurrentHoleToStorage();
      
      // Move to next hole if not on last hole
      if (currentHole < totalHoles) {
        setCurrentHole(prev => prev + 1);
        // Set start time for next hole
        holeStartTimesRef.current[currentHole + 1] = Date.now();
      }
      
      // Analytics: Track successful hole completion
      if (posthog && user && round) {
        posthog.capture('hole_completion_success', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          shots_count: holeData[currentHole]?.shots?.length || 0,
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      setLoading(false);
    } catch (error) {
      console.error("Error completing hole:", error);
      setLoading(false);
      Alert.alert("Error", "There was a problem saving your data.");
      
      // Analytics: Track hole completion error
      if (posthog && user && round) {
        posthog.capture('hole_completion_error', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          error_message: error.message,
          data_availability: false,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  /**
   * Complete the round - save all hole data to database
   * Enhanced to include POI data in the saved hole_data
   * Analytics: Comprehensive round completion tracking with individual database operation monitoring
   */
  const finishRound = async () => {
    try {
      // Show loading state
      setLoading(true);
      roundCompletionStartRef.current = Date.now();
      
      // Analytics: Track round completion start
      if (posthog && user && round) {
        posthog.capture('round_completion_started', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          total_holes: totalHoles,
          total_shots: getTotalShotsRecorded(),
          timestamp: new Date().toISOString()
        });
      }
      
      // Save current hole first
      // Analytics: Track current hole save checkpoint
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'current_hole_save_started',
          hole_number: currentHole,
          timestamp: new Date().toISOString()
        });
      }
      
      await saveCurrentHoleToStorage();
      
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'current_hole_save_completed',
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Get all stored hole data
      // Analytics: Track hole data retrieval checkpoint
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'hole_data_retrieval_started',
          timestamp: new Date().toISOString()
        });
      }
      
      const storedDataStr = await AsyncStorage.getItem(`round_${round.id}_holes`);
      if (!storedDataStr) {
        throw new Error("No hole data found for this round");
      }
      
      const storedHoleData = JSON.parse(storedDataStr);
      
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'hole_data_retrieval_completed',
          holes_with_data: Object.keys(storedHoleData).length,
          data_size: storedDataStr.length,
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Save each hole to the database - Track individual operations
      let holesProcessed = 0;
      let holesSaved = 0;
      
      for (let holeNum = 1; holeNum <= totalHoles; holeNum++) {
        // Skip holes with no data
        if (!storedHoleData[holeNum] || storedHoleData[holeNum].shots.length === 0) {
          continue;
        }
        
        holesProcessed++;
        
        // Analytics: Track individual hole save start
        if (posthog && user && round) {
          posthog.capture('round_completion_checkpoint', {
            profile_id: user.id,
            round_id: round.id,
            checkpoint: 'individual_hole_save_started',
            hole_number: holeNum,
            shots_count: storedHoleData[holeNum].shots.length,
            timestamp: new Date().toISOString()
          });
        }
        
        const holeInfo = storedHoleData[holeNum];
        const totalScore = holeInfo.shots.length;
        
        // Create hole data object including POI data
        const holeDataForDb = {
          par: holeInfo.par,
          distance: holeInfo.distance,
          index: holeInfo.index,
          features: holeInfo.features,
          shots: holeInfo.shots,
          poi: holeInfo.poi // Include POI data in database record
        };
        
        try {
          // Save hole data to database
          await saveHoleData(
            round.id,
            holeNum,
            holeDataForDb,
            totalScore
          );
          
          console.log(`Hole ${holeNum} data saved to database`);
          holesSaved++;
          
          // Analytics: Track individual hole save success
          if (posthog && user && round) {
            posthog.capture('round_completion_checkpoint', {
              profile_id: user.id,
              round_id: round.id,
              checkpoint: 'individual_hole_save_completed',
              hole_number: holeNum,
              shots_count: totalScore,
              has_poi_data: !!holeInfo.poi,
              data_availability: true,
              timestamp: new Date().toISOString()
            });
          }
        } catch (holeError) {
          console.error(`Error saving hole ${holeNum}:`, holeError);
          
          // Analytics: Track individual hole save error
          if (posthog && user && round) {
            posthog.capture('round_completion_checkpoint', {
              profile_id: user.id,
              round_id: round.id,
              checkpoint: 'individual_hole_save_failed',
              hole_number: holeNum,
              error_message: holeError.message,
              data_availability: false,
              timestamp: new Date().toISOString()
            });
          }
          
          throw holeError;
        }
      }
      
      // Analytics: Track all holes save completion
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'all_holes_saved',
          holes_processed: holesProcessed,
          holes_saved: holesSaved,
          data_availability: holesSaved === holesProcessed,
          timestamp: new Date().toISOString()
        });
      }
      
      // Complete the round - Track database round completion
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'round_completion_database_started',
          timestamp: new Date().toISOString()
        });
      }
      
      await completeRound(round.id);
      console.log("Round completed successfully");
      
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'round_completion_database_completed',
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Clear AsyncStorage data for this round - Track storage cleanup
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'storage_cleanup_started',
          timestamp: new Date().toISOString()
        });
      }
      
      await AsyncStorage.removeItem(`round_${round.id}_holes`);
      await AsyncStorage.removeItem("currentRound");
      
      if (posthog && user && round) {
        posthog.capture('round_completion_checkpoint', {
          profile_id: user.id,
          round_id: round.id,
          checkpoint: 'storage_cleanup_completed',
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Analytics: Track successful round completion
      const roundCompletionDuration = roundCompletionStartRef.current ? 
        Date.now() - roundCompletionStartRef.current : null;
      
      if (posthog && user && round) {
        posthog.capture('round_completion_success', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          total_holes: totalHoles,
          holes_with_data: holesProcessed,
          holes_saved: holesSaved,
          total_shots: getTotalShotsRecorded(),
          completion_duration_ms: roundCompletionDuration,
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Navigate to scorecard with replace to prevent back navigation to the tracker
      // This creates a cleaner flow where completing a round leads directly to the scorecard
      // Analytics: Track navigation to scorecard
      if (posthog && user && round) {
        posthog.capture('round_completion_navigation', {
          profile_id: user.id,
          round_id: round.id,
          destination: 'scorecard',
          navigation_type: 'replace',
          timestamp: new Date().toISOString()
        });
      }
      
      navigation.replace("ScorecardScreen", { 
        roundId: round.id,
        fromTracker: true // Add flag to indicate we came from tracker
      });
      
    } catch (error) {
      console.error("Error finishing round:", error);
      setLoading(false);
      Alert.alert(
        "Error",
        "There was a problem completing your round. Please try again."
      );
      
      // Analytics: Track round completion error
      const roundCompletionDuration = roundCompletionStartRef.current ? 
        Date.now() - roundCompletionStartRef.current : null;
      
      if (posthog && user && round) {
        posthog.capture('round_completion_error', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          error_message: error.message,
          completion_duration_ms: roundCompletionDuration,
          data_availability: false,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  // Calculate total score for current hole
  const currentHoleScore = holeData[currentHole]?.shots?.length || 0;
  const currentHolePar = holeData[currentHole]?.par || 0;
  const scoreRelativeToPar = currentHoleScore - currentHolePar;
  
  // Add color-coding helper function for score display
  const getScoreColor = () => {
    if (scoreRelativeToPar < 0) return theme.colors.success; // Under par (good)
    if (scoreRelativeToPar > 0) return theme.colors.error;   // Over par (bad)
    return theme.colors.text;  // At par (neutral)
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* 1. Navigator - KEEP EXISTING */}
        <View style={styles.navigatorContainer}>
          <HoleNavigator
            currentHole={currentHole}
            onPreviousHole={handlePreviousHole}
            onNextHole={handleNextHole}
            totalHoles={totalHoles}
          />
        </View>

        {/* 2. Integrated Hole Info + Score - NEW COMPONENT */}
        <View style={styles.holeInfoContainer}>
          <View style={styles.holeDetailsSection}>
            <Typography variant="body" style={styles.holeInfoText}>
              Hole {currentHole} • Par {holeData[currentHole]?.par || "?"} • {holeData[currentHole]?.distance || "?"} yds
            </Typography>
            
            <View style={styles.scoreIndicator}>
              <Typography 
                variant="body" 
                weight="semibold"
                color={getScoreColor()}
                style={styles.scoreText}
              >
                {currentHoleScore}
              </Typography>
            </View>
          </View>
        </View>

        {/* Show loading indicator when saving data */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Typography variant="body" style={styles.loadingText}>
              Saving your data...
            </Typography>
          </View>
        ) : (
          <View style={styles.contentContainer}>
            {/* 3. Distance Indicator - MAINTAINED POSITION */}
            <DistanceIndicator 
              holeData={holeData[currentHole]} 
              active={!loading} 
            />
            
            {/* 4. Shot Table - MAINTAINED POSITION BUT EXPANDED HEIGHT */}
            <View style={styles.tableContainer}>
              <ShotTable
                shotCounts={holeData[currentHole].shotCounts}
                activeColumn={activeColumn}
                setActiveColumn={setActiveColumn}
                addShot={addShot}
                removeShot={removeShot}
              />
            </View>
            
            {/* 5. Action Button - MAINTAINED POSITION */}
            <View style={styles.buttonContainer}>
              <Button
                variant="primary"
                size="large"
                fullWidth
                onPress={currentHole === totalHoles ? finishRound : completeHole}
                loading={loading}
              >
                {currentHole === totalHoles ? "Complete Round" : "Complete Hole"}
              </Button>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    minHeight: '100%',
  },
  navigatorContainer: {
    marginBottom: 6,
    alignItems: 'center',
  },
  holeInfoContainer: {
    marginBottom: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 10,
  },
  holeDetailsSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holeInfoText: {
    color: '#444',
    flex: 1,
  },
  scoreIndicator: {
    marginLeft: 12,
    minWidth: 30,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 18,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  contentContainer: {
    flex: 1,
    justifyContent: "space-between",
  },
  tableContainer: {
    width: '100%',
    marginBottom: 12,
  },
  buttonContainer: {
    marginBottom: theme.spacing.medium,
    paddingHorizontal: theme.spacing.medium,
  }
});