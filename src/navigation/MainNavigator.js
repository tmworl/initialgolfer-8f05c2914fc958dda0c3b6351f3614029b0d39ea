// src/navigation/MainNavigator.js

import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from '@expo/vector-icons';
import HomeStack from "./HomeStack";
import RoundsStack from "./RoundsStack";
import InsightsScreen from "../screens/InsightsScreen";
import ProfileScreen from "../screens/ProfileScreen";

// Import our navigation styling system
import navigationTheme from "../ui/navigation/theme";
import { getTabBarConfig, getTabNavigatorScreenOptions } from "../ui/navigation/configs/tabBar";
import { 
  createStackNavigatorScreenOptions,
  createRoundsStackConfig, 
  createInsightsStackConfig, 
  createProfileStackConfig 
} from "../ui/navigation/configs/stack";

// Create stack navigators for each tab that needs nested navigation
const RoundsStack = createStackNavigator();
const InsightsStack = createStackNavigator();
const ProfileStack = createStackNavigator();

/**
 * RoundsStackScreen Component
 * 
 * Creates a stack navigator for the Rounds tab with consistent headers
 * This allows navigation from the rounds list to the scorecard view
 */
function RoundsStackScreen() {
  // Get configuration for the rounds stack
  const config = createRoundsStackConfig();
  
  return (
    <RoundsStack.Navigator screenOptions={config.screenOptions}>
      <RoundsStack.Screen 
        name="RoundsScreen" 
        component={RoundsScreen} 
        options={config.screenConfigs.RoundsScreen.options}
      />
      <RoundsStack.Screen 
        name="ScorecardScreen" 
        component={ScorecardScreen} 
        options={config.screenConfigs.ScorecardScreen.options}
      />
    </RoundsStack.Navigator>
  );
}

/**
 * InsightsStackScreen Component
 * 
 * Creates a stack navigator for the Insights tab with consistent headers
 */
function InsightsStackScreen() {
  // Get configuration for the insights stack
  const config = createInsightsStackConfig();
  
  return (
    <InsightsStack.Navigator screenOptions={config.screenOptions}>
      <InsightsStack.Screen 
        name="InsightsScreen" 
        component={InsightsScreen}
        options={config.screenConfigs.InsightsScreen.options}
      />
    </InsightsStack.Navigator>
  );
}

/**
 * ProfileStackScreen Component
 * 
 * Creates a stack navigator for the Profile tab with consistent headers
 */
function ProfileStackScreen() {
  // Get configuration for the profile stack
  const config = createProfileStackConfig();
  
  return (
    <ProfileStack.Navigator screenOptions={config.screenOptions}>
      <ProfileStack.Screen 
        name="ProfileScreen" 
        component={ProfileScreen}
        options={config.screenConfigs.ProfileScreen.options}
      />
    </ProfileStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

/**
 * MainNavigator Component
 * 
 * Creates the bottom tab navigation for the app with four tabs:
 * - Home: For starting new rounds and seeing recent activity
 * - Rounds: For viewing completed rounds and scorecards
 * - Insights: For viewing AI-powered game analysis and improvement tips
 * - Profile: For user account settings
 */
export default function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          
          switch (route.name) {
            case 'Home':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Rounds':
              iconName = focused ? 'golf' : 'golf-outline';
              break;
            case 'Insights':
              iconName = focused ? 'analytics' : 'analytics-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Rounds" component={RoundsStack} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}