// src/screens/TrackerScreen.js
//
// ENHANCED ROUND COMPLETION INTEGRATION
// Integrates sequential completion pipeline with step-by-step progress UI
// and intelligent retry capabilities with error context preservation

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
import { 
  createRound, 
  saveHoleData, 
  deleteAbandonedRound,
  completeRoundSequential,
  setPostHogInstance,
  detectResumePoint
} from "../services/roundservice";
import ShotTable from "../components/ShotTable";
import HoleNavigator from "../components/HoleNavigator";
import { AuthContext } from "../context/AuthContext";
import Typography from "../ui/components/Typography";
import Button from "../ui/components/Button";
import DistanceIndicator from '../components/DistanceIndicator';

/**
 * Enhanced TrackerScreen Component
 * 
 * Integrates with the new sequential round completion system providing
 * transparent progress indication, intelligent retry capabilities,
 * and comprehensive error recovery.
 */
export default function TrackerScreen({ navigation }) {
  // Get the authenticated user from context
  const { user, getAuthTelemetryContext } = useContext(AuthContext);
  
  // PostHog analytics hook with service integration
  const posthog = usePostHog();
  
  // Initialize PostHog instance in the round service
  useEffect(() => {
    if (posthog) {
      setPostHogInstance(posthog);
    }
  }, [posthog]);
  
  // Local state for tracking current hole and shots
  const [currentHole, setCurrentHole] = useState(1);
  const [totalHoles] = useState(18);
  
  // Initialize hole data structure for all holes
  const initialHoleState = {};
  for (let i = 1; i <= 18; i++) {
    initialHoleState[i] = {
      par: null,
      distance: null,
      index: null,
      features: [],
      shots: [],
      shotCounts: {
        "Tee Shot": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Long Shot": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Approach": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Chip": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Putts": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Sand": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 },
        "Penalties": { "On Target": 0, "Slightly Off": 0, "Recovery Needed": 0 }
      },
      poi: null
    };
  }
  
  // Main state variables for the component
  const [holeData, setHoleData] = useState(initialHoleState);
  const [round, setRound] = useState(null);
  const [activeColumn, setActiveColumn] = useState("On Target");
  const [loading, setLoading] = useState(false);
  const [course, setCourse] = useState(null);
  const [courseDetails, setCourseDetails] = useState(null);
  
  // ENHANCED: Completion progress state
  const [completionProgress, setCompletionProgress] = useState({
    isCompleting: false,
    currentStep: null,
    currentStepDescription: null,
    error: null,
    canRetry: false,
    preservedErrorContext: null
  });

  // Analytics tracking references
  const screenEntryTimeRef = useRef(Date.now());
  const roundStartTimeRef = useRef(null);
  const holeStartTimesRef = useRef({});
  const roundCompletionStartRef = useRef(null);
  
  // Analytics monitoring references
  const previousShotCountsRef = useRef({});

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
      const currentCounts = {};
      const previousCounts = {};
      
      currentHoleShots.forEach(shot => {
        const key = `${shot.type}_${shot.result}`;
        currentCounts[key] = (currentCounts[key] || 0) + 1;
      });
      
      previousHoleShots.forEach(shot => {
        const key = `${shot.type}_${shot.result}`;
        previousCounts[key] = (previousCounts[key] || 0) + 1;
      });
      
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
        if (round && round.id && !completionProgress.isCompleting) {
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
                    
                    await deleteAbandonedRound(round.id);
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
    }, [navigation, round, setLoading, posthog, user, currentHole, completionProgress.isCompleting])
  );

  // Android Hardware Back Button Handler - Enhanced with delete logic and analytics
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (round && round.id && !completionProgress.isCompleting) {
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
  }, [round, navigation, setLoading, posthog, user, currentHole, completionProgress.isCompleting]);

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
   * UNCHANGED - preserves existing functionality
   */
  const saveCurrentHoleToStorage = useCallback(async () => {
    if (!round) return;
    
    try {
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
      
      const existingDataStr = await AsyncStorage.getItem(`round_${round.id}_holes`);
      const existingData = existingDataStr ? JSON.parse(existingDataStr) : {};
      
      existingData[currentHole] = holeData[currentHole];
      
      await AsyncStorage.setItem(`round_${round.id}_holes`, JSON.stringify(existingData));
      console.log(`Saved hole ${currentHole} data to AsyncStorage`);
      
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
   * UNCHANGED - preserves existing functionality
   */
  const loadHoleDataFromStorage = useCallback(async () => {
    if (!round) return;
    
    try {
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
        
        setHoleData(prevData => {
          const newData = { ...prevData };
          
          Object.keys(storedData).forEach(holeNum => {
            newData[holeNum] = storedData[holeNum];
          });
          
          return newData;
        });
        
        console.log("Loaded hole data from AsyncStorage");
        
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
   * UNCHANGED - preserves existing functionality
   */
  const handleNextHole = useCallback(async () => {
    if (currentHole < totalHoles) {
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
      
      await saveCurrentHoleToStorage();
      
      setCurrentHole(prev => {
        const nextHole = prev + 1;
        holeStartTimesRef.current[nextHole] = Date.now();
        
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
      Alert.alert(
        "End of Round",
        "You've reached the last hole. Would you like to finish the round?",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Finish Round", 
            onPress: () => {
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
   * UNCHANGED - preserves existing functionality
   */
  const handlePreviousHole = useCallback(async () => {
    if (currentHole > 1) {
      await saveCurrentHoleToStorage();
      
      setCurrentHole(prev => {
        const prevHole = prev - 1;
        
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
   * UNCHANGED - preserves existing functionality
   */
  useEffect(() => {
    if (courseDetails && courseDetails.holes) {
      const currentHoleInfo = courseDetails.holes.find(
        hole => hole.number === currentHole
      );
      
      if (currentHoleInfo) {
        const selectedTeeName = round?.selected_tee_name?.toLowerCase() || course?.teeName?.toLowerCase();
        
        let distance = null;
        if (currentHoleInfo.distances && selectedTeeName && currentHoleInfo.distances[selectedTeeName]) {
          distance = currentHoleInfo.distances[selectedTeeName];
        } else if (currentHoleInfo.distances) {
          const firstTee = Object.keys(currentHoleInfo.distances)[0];
          if (firstTee) {
            distance = currentHoleInfo.distances[firstTee];
          }
        }
        
        let holePoi = null;
        if (course && course.poi && Array.isArray(course.poi)) {
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
        
        setHoleData(prevData => {
          const newData = { ...prevData };
          
          if (!newData[currentHole].par) {
            newData[currentHole] = {
              ...newData[currentHole],
              par: currentHoleInfo.par_men || null,
              distance: distance || null,
              index: currentHoleInfo.index_men || null,
              features: currentHoleInfo.features || [],
              poi: holePoi
            };
            
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
   * UNCHANGED - preserves existing functionality
   */
  useEffect(() => {
    const initializeRound = async () => {
      try {
        if (!user) {
          console.warn("No user found. Cannot create a round without a signed-in user.");
          return;
        }
        
        roundStartTimeRef.current = Date.now();
        if (posthog) {
          posthog.capture('round_initialization_started', {
            profile_id: user.id,
            timestamp: new Date().toISOString()
          });
        }
        
        const storedCourseData = await AsyncStorage.getItem("selectedCourse");
        if (!storedCourseData) {
          console.error("No course selected. Cannot start a round.");
          
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
        
        if (courseData.poi && Array.isArray(courseData.poi)) {
          console.log(`Course has POI data for ${courseData.poi.length} holes`);
        } else {
          console.log("Course does not have POI data");
        }
        
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
        
        const existingRoundStr = await AsyncStorage.getItem("currentRound");
        let roundData;
        
        if (existingRoundStr) {
          roundData = JSON.parse(existingRoundStr);
          console.log("Resuming existing round:", roundData);
          setRound(roundData);
          
          if (posthog && user) {
            posthog.capture('round_resumed', {
              profile_id: user.id,
              round_id: roundData.id,
              course_id: roundData.course_id,
              timestamp: new Date().toISOString()
            });
          }
        } else {
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
          
          await AsyncStorage.setItem("currentRound", JSON.stringify(roundData));
          
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
        
        const { supabase } = require("../services/supabase");
        
        try {
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
        
        if (roundData) {
          await loadHoleDataFromStorage();
        }
        
        holeStartTimesRef.current[1] = Date.now();
        
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
   * UNCHANGED: Pure state update functions for shot management
   */
  const addShot = useCallback((type, outcome) => {
    console.log(`Adding ${outcome} ${type} shot for hole ${currentHole}`);
    
    setHoleData(prevData => {
      const newData = { ...prevData };
      const currentHoleInfo = { ...newData[currentHole] };
      
      currentHoleInfo.shots.push({
        type,
        result: outcome,
        timestamp: new Date().toISOString()
      });
      
      currentHoleInfo.shotCounts[type][outcome] += 1;
      
      newData[currentHole] = currentHoleInfo;
      
      return newData;
    });
  }, [currentHole]);

  const removeShot = useCallback((type, outcome) => {
    console.log(`Removing ${outcome} ${type} shot for hole ${currentHole}`);
    
    setHoleData(prevData => {
      const newData = { ...prevData };
      const currentHoleInfo = { ...newData[currentHole] };
      
      if (currentHoleInfo.shotCounts[type][outcome] <= 0) {
        return prevData;
      }
      
      const shotIndex = [...currentHoleInfo.shots].reverse().findIndex(
        shot => shot.type === type && shot.result === outcome
      );
      
      if (shotIndex !== -1) {
        const actualIndex = currentHoleInfo.shots.length - 1 - shotIndex;
        
        currentHoleInfo.shots.splice(actualIndex, 1);
        currentHoleInfo.shotCounts[type][outcome] -= 1;
        
        newData[currentHole] = currentHoleInfo;
      }
      
      return newData;
    });
  }, [currentHole]);

  /**
   * Complete a hole and save data to AsyncStorage
   * UNCHANGED - preserves existing functionality
   */
  const completeHole = async () => {
    try {
      setLoading(true);
      
      if (posthog && user && round) {
        posthog.capture('hole_completion_started', {
          profile_id: user.id,
          round_id: round.id,
          hole_number: currentHole,
          shots_count: holeData[currentHole]?.shots?.length || 0,
          timestamp: new Date().toISOString()
        });
      }
      
      await saveCurrentHoleToStorage();
      
      if (currentHole < totalHoles) {
        setCurrentHole(prev => prev + 1);
        holeStartTimesRef.current[currentHole + 1] = Date.now();
      }
      
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
   * ENHANCED: Complete the round using the new sequential completion system
   * Provides step-by-step progress and intelligent retry capabilities
   */
  const finishRound = async () => {
    try {
      // Initialize completion progress state
      setCompletionProgress({
        isCompleting: true,
        currentStep: null,
        currentStepDescription: "Preparing to save round...",
        error: null,
        canRetry: false,
        preservedErrorContext: null
      });
      
      roundCompletionStartRef.current = Date.now();
      
      if (posthog && user && round) {
        posthog.capture('enhanced_round_completion_started', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          total_holes: totalHoles,
          total_shots: getTotalShotsRecorded(),
          completion_method: 'sequential',
          timestamp: new Date().toISOString()
        });
      }
      
      // Check for existing checkpoint and offer resume
      const resumeInfo = await detectResumePoint(round.id);
      if (resumeInfo.checkpoint && resumeInfo.preserveError) {
        const shouldResume = await new Promise((resolve) => {
          Alert.alert(
            "Resume Round Completion",
            `We found a previous completion attempt that failed at "${resumeInfo.preserveError.step}". Would you like to resume from where it left off?`,
            [
              { text: "Start Over", onPress: () => resolve(false) },
              { text: "Resume", onPress: () => resolve(true), style: "default" }
            ]
          );
        });
        
        if (!shouldResume) {
          // Clear checkpoint if user wants to start over
          const { clearCompletionCheckpoint } = require("../services/roundservice");
          await clearCompletionCheckpoint(round.id);
        }
      }
      
      // Step descriptions for user feedback
      const stepDescriptions = {
        'saveCurrentHole': 'Saving current hole data...',
        'retrieveAllHoles': 'Collecting all hole data...',
        'validateData': 'Validating round data...',
        'saveToDatabase': 'Uploading to cloud...',
        'markComplete': 'Finalizing round...',
        'generateInsights': 'Analyzing performance...',
        'cleanup': 'Cleaning up...'
      };
      
      // Progress tracking callback
      const onStepProgress = (step) => {
        setCompletionProgress(prev => ({
          ...prev,
          currentStep: step,
          currentStepDescription: stepDescriptions[step] || `Processing ${step}...`,
          error: null
        }));
      };

      // Use the enhanced sequential completion
      const result = await completeRoundSequential(
        round.id, 
        currentHole, 
        holeData[currentHole],
        user.id
      );
      
      // Success - completion finished
      const roundCompletionDuration = roundCompletionStartRef.current ? 
        Date.now() - roundCompletionStartRef.current : null;

      if (posthog && user && round) {
        posthog.capture('enhanced_round_completion_success', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          total_holes: totalHoles,
          total_shots: getTotalShotsRecorded(),
          completion_duration_ms: roundCompletionDuration,
          resumed_from_checkpoint: result.resumedFromCheckpoint,
          completion_method: 'sequential',
          data_availability: true,
          timestamp: new Date().toISOString()
        });
      }
      
      // Clear progress state
      setCompletionProgress({
        isCompleting: false,
        currentStep: null,
        currentStepDescription: null,
        error: null,
        canRetry: false,
        preservedErrorContext: null
      });
      
      // Navigate to scorecard
      navigation.replace("ScorecardScreen", { 
        roundId: round.id,
        fromTracker: true
      });
      
    } catch (error) {
      console.error("Error in enhanced round completion:", error);
      
      const roundCompletionDuration = roundCompletionStartRef.current ? 
        Date.now() - roundCompletionStartRef.current : null;
      
      if (posthog && user && round) {
        posthog.capture('enhanced_round_completion_error', {
          profile_id: user.id,
          round_id: round.id,
          course_id: round.course_id,
          error_step: error.step,
          error_message: error.error?.message || error.message,
          completion_duration_ms: roundCompletionDuration,
          can_retry: error.canRetry,
          completion_method: 'sequential',
          data_availability: false,
          timestamp: new Date().toISOString()
        });
      }
      
      // Update progress state with error information
      setCompletionProgress({
        isCompleting: false,
        currentStep: error.step,
        currentStepDescription: `Failed at: ${stepDescriptions[error.step] || error.step}`,
        error: error.error?.message || error.message,
        canRetry: error.canRetry,
        preservedErrorContext: error
      });
    }
  };

  /**
   * ENHANCED: Retry completion from failure point
   * Uses preserved error context to resume intelligently
   */
  const retryCompletion = async () => {
    if (!completionProgress.preservedErrorContext) {
      // No preserved context, start fresh
      return finishRound();
    }
    
    try {
      setCompletionProgress(prev => ({
        ...prev,
        isCompleting: true,
        error: null,
        currentStepDescription: "Retrying from where we left off..."
      }));
      
      if (posthog && user && round) {
        posthog.capture('round_completion_retry_started', {
          profile_id: user.id,
          round_id: round.id,
          retry_from_step: completionProgress.preservedErrorContext.step,
          timestamp: new Date().toISOString()
        });
      }
      
      // Retry the sequential completion - it will automatically resume from checkpoint
      const result = await completeRoundSequential(
        round.id, 
        currentHole, 
        holeData[currentHole],
        user.id
      );
      
      if (posthog && user && round) {
        posthog.capture('round_completion_retry_success', {
          profile_id: user.id,
          round_id: round.id,
          original_failure_step: completionProgress.preservedErrorContext.step,
          timestamp: new Date().toISOString()
        });
      }
      
      // Clear progress state
      setCompletionProgress({
        isCompleting: false,
        currentStep: null,
        currentStepDescription: null,
        error: null,
        canRetry: false,
        preservedErrorContext: null
      });
      
      // Navigate to scorecard
      navigation.replace("ScorecardScreen", { 
        roundId: round.id,
        fromTracker: true
      });
      
    } catch (retryError) {
      console.error("Error in completion retry:", retryError);
      
      if (posthog && user && round) {
        posthog.capture('round_completion_retry_failed', {
          profile_id: user.id,
          round_id: round.id,
          original_failure_step: completionProgress.preservedErrorContext.step,
          retry_failure_step: retryError.step,
          retry_error_message: retryError.error?.message || retryError.message,
          timestamp: new Date().toISOString()
        });
      }
      
      // Update with new error information
      setCompletionProgress(prev => ({
        ...prev,
        isCompleting: false,
        error: retryError.error?.message || retryError.message,
        currentStepDescription: `Retry failed at: ${retryError.step}`,
        preservedErrorContext: retryError
      }));
    }
  };

  // Calculate total score for current hole
  const currentHoleScore = holeData[currentHole]?.shots?.length || 0;
  const currentHolePar = holeData[currentHole]?.par || 0;
  const scoreRelativeToPar = currentHoleScore - currentHolePar;
  
  const getScoreColor = () => {
    if (scoreRelativeToPar < 0) return theme.colors.success;
    if (scoreRelativeToPar > 0) return theme.colors.error;
    return theme.colors.text;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Navigator */}
        <View style={styles.navigatorContainer}>
          <HoleNavigator
            currentHole={currentHole}
            onPreviousHole={handlePreviousHole}
            onNextHole={handleNextHole}
            totalHoles={totalHoles}
          />
        </View>

        {/* Hole info + Score */}
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

        {/* ENHANCED: Show completion progress or error state */}
        {completionProgress.isCompleting ? (
          <View style={styles.completionProgressContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Typography variant="body" style={styles.completionProgressText}>
              {completionProgress.currentStepDescription}
            </Typography>
            {completionProgress.currentStep && (
              <Typography variant="caption" style={styles.completionStepText}>
                Step: {completionProgress.currentStep}
              </Typography>
            )}
          </View>
        ) : completionProgress.error ? (
          <View style={styles.completionErrorContainer}>
            <Typography variant="body" style={styles.completionErrorText}>
              {completionProgress.currentStepDescription}
            </Typography>
            <Typography variant="caption" style={styles.completionErrorDetail}>
              {completionProgress.error}
            </Typography>
            {completionProgress.canRetry && (
              <Button
                variant="primary"
                onPress={retryCompletion}
                style={styles.retryButton}
              >
                Retry Completion
              </Button>
            )}
          </View>
        ) : loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Typography variant="body" style={styles.loadingText}>
              Saving your data...
            </Typography>
          </View>
        ) : (
          <View style={styles.contentContainer}>
            {/* Distance Indicator */}
            <DistanceIndicator 
              holeData={holeData[currentHole]} 
              active={!loading} 
            />
            
            {/* Shot Table */}
            <View style={styles.tableContainer}>
              <ShotTable
                shotCounts={holeData[currentHole].shotCounts}
                activeColumn={activeColumn}
                setActiveColumn={setActiveColumn}
                addShot={addShot}
                removeShot={removeShot}
              />
            </View>
            
            {/* Action Button */}
            <View style={styles.buttonContainer}>
              <Button
                variant="primary"
                size="large"
                fullWidth
                onPress={currentHole === totalHoles ? finishRound : completeHole}
                loading={loading || completionProgress.isCompleting}
                disabled={loading || completionProgress.isCompleting}
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
  // ENHANCED: Completion progress styles
  completionProgressContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    margin: 8,
  },
  completionProgressText: {
    marginTop: 16,
    fontSize: 16,
    color: "#333",
    textAlign: "center",
  },
  completionStepText: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  completionErrorContainer: {
    padding: 20,
    backgroundColor: '#ffe6e6',
    borderRadius: 8,
    margin: 8,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.error,
  },
  completionErrorText: {
    fontSize: 16,
    color: "#333",
    marginBottom: 8,
  },
  completionErrorDetail: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  retryButton: {
    alignSelf: 'center',
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