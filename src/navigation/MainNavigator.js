// src/navigation/MainNavigator.js
import React, { useEffect, useContext } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

// Import stack and screen components
import HomeStack from "./HomeStack";
import RoundsScreen from "../screens/RoundScreen";
import ScorecardScreen from "../screens/ScorecardScreen";
import InsightsScreen from "../screens/InsightsScreen";
import ProfileScreen from "../screens/ProfileScreen";

// Import authentication context
import { AuthContext } from "../context/AuthContext";

// Create stack navigators for each tab section
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
  return (
    <RoundsStack.Navigator>
      <RoundsStack.Screen 
        name="RoundsScreen" 
        component={RoundsScreen} 
        options={{ title: "Your Rounds" }}
      />
      <RoundsStack.Screen 
        name="ScorecardScreen" 
        component={ScorecardScreen} 
        options={{ title: "Scorecard" }}
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
  return (
    <InsightsStack.Navigator>
      <InsightsStack.Screen 
        name="InsightsScreen" 
        component={InsightsScreen}
        options={{ title: "Insights" }}
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
  return (
    <ProfileStack.Navigator>
      <ProfileStack.Screen 
        name="ProfileScreen" 
        component={ProfileScreen}
        options={{ title: "Your Profile" }}
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
 * 
 * Tab bar visibility is strategically controlled for focused user experiences.
 */
export default function MainNavigator() {
  // Get the authenticated user from context
  const { user } = useContext(AuthContext);
  
  /**
   * Determines tab bar visibility based on focused route
   * Hides tab bar for focused round experiences and scorecard reviews
   * 
   * @param {Object} route - Navigation route object
   * @returns {string} CSS display value: 'none' or 'flex'
   */
  const getTabBarVisibility = (route) => {
    const routeName = getFocusedRouteNameFromRoute(route);
    
    // Define screens where tab bar should be hidden for focused experience
    const hiddenRoutes = [
      // Home stack screens
      'CourseSelector',    // Course selection flow
      'Tracker',          // Active round tracking
      'Scorecard',        // Scorecard after completing round
      // Rounds stack screens
      'ScorecardScreen'   // Historical scorecard review
    ];
    
    return hiddenRoutes.includes(routeName) ? 'none' : 'flex';
  };
  
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
            default:
              iconName = 'help-outline';
              break;
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen 
        name="Home" 
        component={HomeStack}
        options={({ route }) => ({
          tabBarStyle: {
            display: getTabBarVisibility(route),
          },
        })}
      />
      <Tab.Screen 
        name="Rounds" 
        component={RoundsStackScreen}
        options={({ route }) => ({
          tabBarStyle: {
            display: getTabBarVisibility(route),
          },
        })}
      />
      <Tab.Screen name="Insights" component={InsightsStackScreen} />
      <Tab.Screen name="Profile" component={ProfileStackScreen} />
    </Tab.Navigator>
  );
}