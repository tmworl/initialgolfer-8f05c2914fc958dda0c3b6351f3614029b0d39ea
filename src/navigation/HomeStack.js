// src/navigation/HomeStack.js

import React from "react";
import { createStackNavigator } from "@react-navigation/stack";
import HomeScreen from "../screens/HomeScreen";
import CourseSelectorScreen from "../screens/CourseSelectorScreen";
import TrackerScreen from "../screens/TrackerScreen";
import ScorecardScreen from "../screens/ScorecardScreen";

const Stack = createStackNavigator();

/**
 * HomeStack Component
 * 
 * Creates the navigation stack for the home tab with consistent native headers:
 * - HomeScreen: Starting point with recent rounds and "Start New Round" button
 * - CourseSelectorScreen: For selecting a course
 * - TrackerScreen: For tracking shots during a round
 * - ScorecardScreen: For viewing detailed scorecard after completing a round
 */
export default function HomeStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen 
        name="HomeScreen" 
        component={HomeScreen}
        options={{ title: "Clubhouse" }}
      />
      <Stack.Screen 
        name="CourseSelector" 
        component={CourseSelectorScreen}
        options={{ title: "Select Course" }}
      />
      <Stack.Screen 
        name="Tracker" 
        component={TrackerScreen}
        options={{
          title: "Round Tracker",
          headerLeft: () => null // Prevent back navigation during active round
        }}
      />
      <Stack.Screen 
        name="Scorecard" 
        component={ScorecardScreen}
        options={{ title: "Scorecard" }}
      />
    </Stack.Navigator>
  );
}