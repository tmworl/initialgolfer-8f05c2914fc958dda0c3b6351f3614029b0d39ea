// src/context/AuthContext.js
//
// FOCUSED ENHANCEMENT: Only adds getAuthTelemetryContext() for round completion correlation
// All other functionality remains identical to preserve existing behavior

import React, { createContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";
import { supabase } from "../services/supabase";
import purchaseService from "../services/purchaseService";
import { usePostHog } from 'posthog-react-native';
// Import navigation reference for programmatic navigation
import { navigationRef } from "../../App";

// Create an authentication context
export const AuthContext = createContext();

// Utility function to check email verification status
const checkEmailVerification = (userData) => {
  return userData && userData.email_confirmed_at ? true : false;
};

// RevenueCat initialization helper - non-blocking and failure-tolerant
const initializeRevenueCatForUser = async (userId) => {
  try {
    console.log("Initializing RevenueCat for user:", userId);
    const initialized = await purchaseService.initializePurchases(userId);
    if (initialized) {
      console.log("RevenueCat initialized successfully for user:", userId);
    } else {
      console.warn("RevenueCat initialization failed - purchases disabled but app continues normally");
    }
    return initialized;
  } catch (error) {
    console.error("RevenueCat initialization error:", error);
    // This is non-blocking - app continues to function normally
    return false;
  }
};

// AuthProvider wraps the entire app and provides auth state and functions
export const AuthProvider = ({ children }) => {
  // 'user' holds the currently authenticated user, or null if not authenticated.
  const [user, setUser] = useState(null);
  // 'emailVerified' tracks whether the user has verified their email
  const [emailVerified, setEmailVerified] = useState(false);
  // 'pendingVerificationEmail' stores the email address awaiting verification
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);
  // 'loading' tracks whether an auth operation is in progress.
  const [loading, setLoading] = useState(true);
  // 'error' stores any error messages from auth operations.
  const [error, setError] = useState(null);
  // 'userPermissions' stores the user's product permissions
  const [userPermissions, setUserPermissions] = useState([]);
  // Add PostHog hook
  const posthog = usePostHog();

  // Navigation function for successful verification
  const handleSuccessfulVerification = useCallback(() => {
    if (navigationRef.current) {
      // Use resetRoot for React Navigation 6+
      navigationRef.current.resetRoot({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    } else {
      console.warn("Navigation reference is not ready - can't redirect yet");
    }
  }, []);

  // Load user permissions from the database
  const loadUserPermissions = async (userId) => {
    if (!userId) return;
    
    try {
      console.log("Loading permissions for user:", userId);
      
      const { data, error } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("profile_id", userId)
        .eq("active", true);
        
      if (error) {
        console.error("Error loading user permissions:", error);
        return;
      }
      
      console.log("Loaded permissions:", data?.length);
      setUserPermissions(data || []);
    } catch (err) {
      console.error("Exception loading user permissions:", err);
    }
  };

  // Helper function to check if a user has a specific product permission
  const hasPermission = useCallback((productId) => {
    return userPermissions.some(
      permission => permission.permission_id === productId && permission.active
    );
  }, [userPermissions]);

  /**
   * FOCUSED ADDITION: Get authentication telemetry context for round completion error correlation
   * This provides structured auth data for PostHog to correlate completion failures with auth issues
   * 
   * @returns {Promise<Object>} Structured auth context for telemetry
   */
  const getAuthTelemetryContext = useCallback(async () => {
    try {
      // Get current session information
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session?.access_token) {
        return {
          hasValidToken: false,
          tokenAge: null,
          sessionValid: false,
          userId: user?.id || null,
          permissions: userPermissions.map(p => p.permission_id)
        };
      }
      
      // Calculate token age if session exists
      let tokenAge = null;
      let sessionValid = false;
      
      if (session.expires_at) {
        const expiryTime = new Date(session.expires_at).getTime();
        const currentTime = Date.now();
        const issuedTime = expiryTime - (60 * 60 * 1000); // Assume 1 hour validity
        
        tokenAge = Math.floor((currentTime - issuedTime) / 1000 / 60); // in minutes
        sessionValid = currentTime < expiryTime;
      }
      
      return {
        hasValidToken: true,
        tokenAge,
        sessionValid,
        emailVerified,
        userId: user?.id || null,
        permissions: userPermissions.map(p => p.permission_id),
        hasProductA: hasPermission("product_a")
      };
    } catch (exception) {
      console.error("Exception getting auth telemetry context:", exception);
      return {
        hasValidToken: false,
        tokenAge: null,
        sessionValid: false,
        userId: user?.id || null,
        permissions: []
      };
    }
  }, [user, emailVerified, userPermissions, hasPermission]);

  // Handle deep links for email verification
  const handleDeepLink = async (event) => {
    const url = event?.url || event;
    if (!url) return;

    console.log("Received deep link:", url);
    
    // Check if this is a verification callback URL
    if (url.startsWith("mygolfapp://login-callback")) {
      console.log("Processing verification deep link");
      
      try {
        // Refresh the auth state to get the updated verification status
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError) {
          console.error("Error refreshing session:", refreshError);
          return;
        }
        
        if (data?.session?.user) {
          setUser(data.session.user);
          
          // Check if email is now verified
          const isVerified = checkEmailVerification(data.session.user);
          setEmailVerified(isVerified);
          
          // Load user permissions
          await loadUserPermissions(data.session.user.id);
          
          // Initialize RevenueCat for verified user (non-blocking)
          if (isVerified) {
            initializeRevenueCatForUser(data.session.user.id);
          }
          
          if (isVerified && pendingVerificationEmail) {
            console.log("Email verified successfully!");
            // Clear pending verification state
            setPendingVerificationEmail(null);
            await AsyncStorage.removeItem('@GolfApp:pendingVerificationEmail');
            
            // Trigger navigation to main app
            handleSuccessfulVerification();
          }
        }
      } catch (err) {
        console.error("Error processing verification link:", err);
      }
    }
  };

  // On mount, check if a session already exists and restore verification state.
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check for existing session
        const { data } = await supabase.auth.getSession();
        
        if (data?.session?.user) {
          setUser(data.session.user);
          // Set email verification status based on email_confirmed_at
          setEmailVerified(checkEmailVerification(data.session.user));
          
          // Load user permissions
          await loadUserPermissions(data.session.user.id);
          
          // Initialize RevenueCat for existing authenticated user (non-blocking)
          // This happens in background and doesn't affect app startup
          initializeRevenueCatForUser(data.session.user.id);
        } else {
          // No active session, check for pending verification
          const pendingEmail = await AsyncStorage.getItem('@GolfApp:pendingVerificationEmail');
          if (pendingEmail) {
            setPendingVerificationEmail(pendingEmail);
          }
        }
      } catch (err) {
        console.error("Error checking auth session:", err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Subscribe to auth state changes. This ensures our UI always reflects the latest auth state.
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event);
      
      if (session?.user) {
        setUser(session.user);
        // Update email verification status
        const isVerified = checkEmailVerification(session.user);
        setEmailVerified(isVerified);
        
        // Load user permissions
        await loadUserPermissions(session.user.id);
        
        // Initialize RevenueCat for authenticated user (non-blocking)
        // This runs asynchronously and doesn't block the auth flow
        initializeRevenueCatForUser(session.user.id);
        
        // If user is now verified and we had a pending verification, clear it
        if (isVerified && pendingVerificationEmail) {
          setPendingVerificationEmail(null);
          AsyncStorage.removeItem('@GolfApp:pendingVerificationEmail');
        }
      } else {
        setUser(null);
        setEmailVerified(false);
        setUserPermissions([]); // Clear permissions when user logs out
      }
    });

    // Set up deep link handling
    // First, check if the app was opened with a URL
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink(url);
    });

    // Then listen for future URL events
    const linkingListener = Linking.addEventListener('url', handleDeepLink);

    // Clean up subscriptions when the component unmounts.
    return () => {
      authListener.subscription.unsubscribe();
      linkingListener.remove();
    };
  }, [pendingVerificationEmail]);

  // signIn: Calls Supabase to sign in with email and password.
  const signIn = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setUser(data.user);
        setEmailVerified(checkEmailVerification(data.user));
        
        // Load user permissions after successful sign in
        await loadUserPermissions(data.user.id);
        
        // Initialize RevenueCat for signed-in user (non-blocking)
        initializeRevenueCatForUser(data.user.id);
        
        // ADD: PostHog user identification (non-blocking)
        try {
          posthog.identify(data.user.id, {
            email: data.user.email,
            email_verified: checkEmailVerification(data.user),
            sign_in_method: 'email_password',
            user_created_at: data.user.created_at,
          });
          console.log('[Analytics] User identified successfully');
        } catch (analyticsError) {
          console.warn('[Analytics] Failed to identify user:', analyticsError);
          // Don't block sign-in flow for analytics failures
        }
      }
    } catch (err) {
      setError("An unexpected error occurred during sign in.");
      console.error("SignIn error:", err);
    } finally {
      setLoading(false);
    }
  };

  // signUp: Calls Supabase to create a new account.
  // Note: You can adjust the emailRedirectTo option based on your native environment.
  const signUp = async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: "mygolfapp://login-callback" // Use our configured redirect
        }
      });
      
      if (error) {
        // Check specifically for duplicate account errors
        if (error.message.includes("already registered") || error.code === "23505") {
          setError("This email is already registered. Please sign in instead.");
        } else {
          setError(error.message);
        }
      } else {
        // Store the user but flag as unverified
        setUser(data.user);
        setEmailVerified(false);
        
        // Store pending verification email
        setPendingVerificationEmail(email);
        await AsyncStorage.setItem('@GolfApp:pendingVerificationEmail', email);
        
        // Note: RevenueCat initialization happens only after email verification
      }
    } catch (err) {
      setError("An unexpected error occurred during sign up.");
      console.error("SignUp error:", err);
    } finally {
      setLoading(false);
    }
  };

  // resendVerificationEmail: Resends the verification email.
  const resendVerificationEmail = async (email = null) => {
    setLoading(true);
    setError(null);
    try {
      // Use provided email or fall back to pending email
      const emailToVerify = email || pendingVerificationEmail;
      
      if (!emailToVerify) {
        setError("No email address to verify");
        return;
      }
      
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: emailToVerify,
        options: {
          emailRedirectTo: "mygolfapp://login-callback"
        }
      });
      
      if (error) {
        setError(error.message);
      } else {
        // If a new email was provided, update the pending verification
        if (email && email !== pendingVerificationEmail) {
          setPendingVerificationEmail(email);
          await AsyncStorage.setItem('@GolfApp:pendingVerificationEmail', email);
        }
      }
    } catch (err) {
      setError("Failed to resend verification email");
      console.error("Resend verification error:", err);
    } finally {
      setLoading(false);
    }
  };

  // signOut: Calls Supabase to end the session.
  const signOut = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setError(error.message);
      } else {
        setUser(null);
        setEmailVerified(false);
        setPendingVerificationEmail(null);
        setUserPermissions([]); // Clear permissions on sign out
        await AsyncStorage.removeItem('@GolfApp:pendingVerificationEmail');
        
        // ADD: Reset PostHog analytics
        try {
          posthog.reset();
          console.log('[Analytics] Analytics reset on sign out');
        } catch (analyticsError) {
          console.warn('[Analytics] Failed to reset analytics:', analyticsError);
        }
      }
    } catch (err) {
      setError("Failed to sign out");
      console.error("SignOut error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Provide the state and functions to any child component.
  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      error, 
      signIn, 
      signUp, 
      signOut, 
      setError,
      emailVerified,
      pendingVerificationEmail,
      resendVerificationEmail,
      userPermissions,
      hasPermission,
      // FOCUSED ADDITION: Only export telemetry context function for round completion correlation
      getAuthTelemetryContext
    }}>
      {children}
    </AuthContext.Provider>
  );
};