// src/navigation/AppNavigator.js

import React, { useContext } from "react";
import { createStackNavigator } from "@react-navigation/stack";
import AuthScreen from "../screens/AuthScreen";
import VerificationPendingScreen from "../screens/VerificationPendingScreen";
import MainNavigator from "./MainNavigator";
import { AuthContext } from "../context/AuthContext";

// Removed unused import for navigation styling

const Stack = createStackNavigator();

export default function AppNavigator() {
  // Retrieve both user and verification status from AuthContext
  const { user, emailVerified } = useContext(AuthContext);

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#fff' } // Consistent background color for all screens
      }}
    >
      {!user ? (
        // If no user is authenticated, show the auth screen
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : !emailVerified ? (
        // If user exists but email isn't verified, show verification screen
        <Stack.Screen 
          name="VerifyEmail" 
          component={VerificationPendingScreen}
        />
      ) : (
        // If user is authenticated and verified, show the main app
        <Stack.Screen name="Main" component={MainNavigator} />
      )}
    </Stack.Navigator>
  );
}