// src/components/PremiumButton.js
//
// Strategic purchase flow entry point component
// RevenueCat-powered purchase execution with maintained design system coherence

import React, { useState } from 'react';
import { Alert } from 'react-native';
import Button from '../ui/components/Button';
import purchaseService, { PURCHASE_ERROR_TYPES } from '../services/purchaseService';
import { useNavigation } from '@react-navigation/native';

/**
 * PremiumButton Component
 * 
 * RevenueCat-powered button for initiating in-app purchases with
 * integrated loading states, error handling, and purchase flow management.
 * 
 * Architecturally designed to isolate purchase flow complexity while
 * presenting a consistent UI aligned with our design system.
 * 
 * Key Change: RevenueCat initialization is handled at auth level,
 * removing complex component-level initialization logic.
 * 
 * @param {Object} props Component props
 * @param {string} props.label Text to display on button (defaults to "Upgrade to Premium")
 * @param {string} props.productId Product identifier (maintained for interface compatibility)
 * @param {Function} props.onPurchaseComplete Callback after successful purchase
 * @param {Function} props.onPurchaseFailed Callback after failed purchase
 * @param {string} props.variant Button visual variant (see Button component)
 * @param {Object} props.style Additional styles to apply
 */
const PremiumButton = ({
  label = "Upgrade to Premium",
  productId = null, // Maintained for interface compatibility, RevenueCat handles product resolution
  onPurchaseComplete = () => {},
  onPurchaseFailed = () => {},
  variant = "primary",
  style,
  ...otherProps
}) => {
  // Simplified state management - RevenueCat handles initialization complexity
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();

  /**
   * Handle purchase initiation with comprehensive error handling
   * and state management throughout the RevenueCat purchase lifecycle
   * 
   * Strategic Change: Direct RevenueCat integration removes manual receipt 
   * validation complexity while maintaining identical error handling interface
   */
  const handlePurchase = async () => {
    // Pre-flight check: Ensure RevenueCat is initialized
    if (!purchaseService.isPurchasesReady()) {
      Alert.alert(
        "Service Unavailable",
        "Purchase service is initializing. Please try again in a moment.",
        [{ text: "OK" }]
      );
      return;
    }
    
    try {
      setLoading(true);
      
      // Initiate purchase via RevenueCat service layer
      // This replaces the complex react-native-iap flow with RevenueCat's
      // unified cross-platform purchase execution
      const result = await purchaseService.purchasePremiumInsights();
      
      setLoading(false);
      
      // Handle cancellation - silent failure maintains existing UX
      if (result.cancelled) {
        return;
      }
      
      // Handle errors with contextual messaging
      // Error structure maintained for compatibility with existing error handling
      if (result.error) {
        const errorMessage = getErrorMessage(result.error);
        Alert.alert("Purchase Failed", errorMessage, [{ text: "OK" }]);
        onPurchaseFailed(result.error);
        return;
      }
      
      // Purchase successful - notify parent and refresh permissions
      // Note: Permission refresh happens via webhook, maintaining your
      // single-source-of-truth architecture
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
   * Maintained identical to existing implementation for seamless transition
   * RevenueCat errors are mapped to your existing error taxonomy
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
      disabled={loading || !purchaseService.isPurchasesReady()}
      iconRight={loading ? undefined : "arrow-forward"}
      style={style}
      {...otherProps}
    >
      {label}
    </Button>
  );
};

export default PremiumButton;