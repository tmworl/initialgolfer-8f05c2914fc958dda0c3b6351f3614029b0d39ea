// src/components/PremiumButton.js
//
// Strategic purchase flow entry point component
// Encapsulates IAP interactions while maintaining design system coherence

import React, { useState, useEffect } from 'react';
import { Alert } from 'react-native';
import Button from '../ui/components/Button';
import purchaseService, { PURCHASE_ERROR_TYPES } from '../services/purchaseService';
import { useNavigation } from '@react-navigation/native';
import theme from '../ui/theme';

/**
 * PremiumButton Component
 * 
 * Specialized button for initiating in-app purchases with
 * integrated loading states, error handling, and purchase flow management.
 * 
 * Architecturally designed to isolate purchase flow complexity while
 * presenting a consistent UI aligned with our design system.
 * 
 * @param {Object} props Component props
 * @param {string} props.label Text to display on button (defaults to "Upgrade to Premium")
 * @param {string} props.productId Product identifier (defaults to platform-specific premium product)
 * @param {Function} props.onPurchaseComplete Callback after successful purchase
 * @param {Function} props.onPurchaseFailed Callback after failed purchase
 * @param {string} props.variant Button visual variant (see Button component)
 * @param {Object} props.style Additional styles to apply
 */
const PremiumButton = ({
  label = "Upgrade to Premium",
  productId = null, // Will use default if not provided
  onPurchaseComplete = () => {},
  onPurchaseFailed = () => {},
  variant = "primary",
  style,
  ...otherProps
}) => {
  // Component state
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const navigation = useNavigation();

  // Initialize IAP connection on mount
  useEffect(() => {
    async function initialize() {
      try {
        const success = await purchaseService.initializePurchases();
        setInitialized(success);
        
        if (!success) {
          console.error("Failed to initialize IAP connection");
        }
      } catch (error) {
        console.error("Error initializing IAP:", error);
      }
    }
    
    initialize();
    
    // Clean up on unmount
    return () => {
      purchaseService.cleanupPurchases();
    };
  }, []);
  
  /**
   * Handle purchase initiation with comprehensive error handling
   * and state management throughout the purchase lifecycle
   */
  const handlePurchase = async () => {
    if (!initialized) {
      Alert.alert(
        "Store Connection Error",
        "Unable to connect to the App Store. Please try again later.",
        [{ text: "OK" }]
      );
      return;
    }
    
    try {
      setLoading(true);
      
      // Initiate purchase via service layer
      const result = await purchaseService.purchasePremiumInsights();
      
      setLoading(false);
      
      // Handle cancellation - silent failure
      if (result.cancelled) {
        return;
      }
      
      // Handle errors with contextual messaging
      if (result.error) {
        const errorMessage = getErrorMessage(result.error);
        Alert.alert("Purchase Failed", errorMessage, [{ text: "OK" }]);
        onPurchaseFailed(result.error);
        return;
      }
      
      // Purchase successful - notify parent and refresh permissions
      Alert.alert(
        "Purchase Successful",
        "Premium features are now available! Enjoy advanced insights and analysis.",
        [{ text: "Great!" }]
      );
      
      onPurchaseComplete(result);
      
    } catch (error) {
      setLoading(false);
      console.error("Purchase flow error:", error);
      
      Alert.alert(
        "Purchase Error",
        "An unexpected error occurred. Please try again later.",
        [{ text: "OK" }]
      );
      
      onPurchaseFailed({ code: PURCHASE_ERROR_TYPES.UNKNOWN, message: error.message });
    }
  };
  
  /**
   * Map error codes to user-friendly messages
   * 
   * @param {Object} error Error object from purchaseService
   * @returns {string} User-friendly error message
   */
  const getErrorMessage = (error) => {
    switch (error.code) {
      case PURCHASE_ERROR_TYPES.CONNECTION:
        return "Network connection failed. Please check your connection and try again.";
        
      case PURCHASE_ERROR_TYPES.ALREADY_OWNED:
        return "You already own this item. Try restoring your purchases in the Profile screen.";
        
      case PURCHASE_ERROR_TYPES.NOT_ALLOWED:
        return "Purchase not allowed. Your account may have restrictions.";
        
      case PURCHASE_ERROR_TYPES.SERVER:
        return "Server validation failed. Please try again later.";
        
      default:
        return error.message || "An unknown error occurred. Please try again later.";
    }
  };
  
  return (
    <Button
      variant={variant}
      onPress={handlePurchase}
      loading={loading}
      disabled={loading || !initialized}
      iconRight={loading ? undefined : "arrow-forward"}
      style={style}
      {...otherProps}
    >
      {label}
    </Button>
  );
};

export default PremiumButton;