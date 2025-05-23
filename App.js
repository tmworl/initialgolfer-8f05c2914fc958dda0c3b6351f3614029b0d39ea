// App.js

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { PostHogProvider } from 'posthog-react-native';
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";

// Create navigation reference for programmatic navigation
export const navigationRef = React.createRef();

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer ref={navigationRef}>
        <PostHogProvider 
          apiKey="phc_gZJF7zsT7LezrguVZByWVm0UT3p0UP9DLq0sJgvjtQ9" 
          options={{
            // EU server configuration (confirmed by user)
            host: 'https://eu.i.posthog.com',
            
            // Production-ready performance configuration
            flushAt: 20,                      // Batch 20 events before sending
            flushInterval: 10000,             // Flush every 10 seconds
            maxBatchSize: 100,                // Maximum batch size
            maxQueueSize: 1000,               // Maximum queue size
            requestTimeout: 10000,            // 10 second timeout
            
            // Lifecycle event tracking
            captureNativeAppLifecycleEvents: true,
            
            // Feature flag configuration (can enable later)
            preloadFeatureFlags: false,
            featureFlagsRequestTimeoutMs: 10000,
            
            // Session configuration
            sessionExpirationTimeSeconds: 1800, // 30 minutes
            enablePersistSessionIdAcrossRestart: true,
            
            // Development vs Production
            // No __DEV__ disabling since you confirmed no dev environment
            disabled: false,
          }}
          autocapture={{
            // Full autocapture configuration as requested
            captureTouches: true,
            captureLifecycleEvents: true,
            captureScreens: true,
            
            // Capture configuration
            propsToCapture: ["testID", "accessibilityLabel"],
            
            // Navigation event enhancement
            navigation: {
              // Enhance screen names with parameters where useful
              routeToName: (name, params) => {
                // Add course ID to course selection screens for better analytics
                if (name === 'CourseSelector' && params?.courseId) {
                  return `${name}/${params.courseId}`;
                }
                // Add round ID to tracker screens
                if (name === 'Tracker' && params?.roundId) {
                  return `${name}/${params.roundId}`;
                }
                return name;
              },
              
              // Capture navigation properties for analysis
              routeToProperties: (name, params) => {
                // Exclude sensitive parameters but include useful analytics data
                if (name === "TrackerScreen") {
                  return {
                    has_course_data: !!params?.courseId,
                    screen_category: 'golf_tracking'
                  };
                }
                if (name === "CourseSelectorScreen") {
                  return {
                    screen_category: 'course_selection'
                  };
                }
                return params ? { screen_category: 'navigation' } : undefined;
              },
            }
          }}
        >
          <AppNavigator />
        </PostHogProvider>
      </NavigationContainer>
    </AuthProvider>
  );
}