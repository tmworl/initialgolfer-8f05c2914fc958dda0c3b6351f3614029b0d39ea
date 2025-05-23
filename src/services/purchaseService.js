// src/services/purchaseService.js
//
// RevenueCat-based purchase service for in-app purchases
// Handles purchase flow while maintaining existing permissions architecture

import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import Constants from 'expo-constants';

// Error types for structured error handling (maintaining existing interface)
export const PURCHASE_ERROR_TYPES = {
  CONNECTION: 'connection_error',
  CANCELLED: 'user_cancelled',
  ALREADY_OWNED: 'already_owned',
  NOT_ALLOWED: 'not_allowed',
  UNKNOWN: 'unknown_error',
  SERVER: 'server_error'
};

// Keep your existing product identifiers
const PRODUCT_IDS = {
  ios: 'com.daybeam.golfimprove.product_a',
  android: 'com.daybeam.golfimprove.product_a'
};

// Internal state tracking
let isConfigured = false;
let currentUserId = null;

/**
 * Initialize RevenueCat SDK with user identification
 * Must be called with user's profile_id before any other operations
 * 
 * @param {string} userId - User's profile_id from Supabase
 * @returns {Promise<boolean>} Success status
 */
export async function initializePurchases(userId) {
  try {
    console.log('Initializing RevenueCat for user:', userId);

    // Get API keys from configuration
    const apiKeys = Constants.expoConfig?.extra?.revenueCatApiKeys;
    if (!apiKeys) {
      throw new Error('RevenueCat API keys not found in configuration');
    }

    const apiKey = Platform.OS === 'ios' ? apiKeys.ios : apiKeys.android;
    if (!apiKey) {
      throw new Error(`RevenueCat API key not found for platform: ${Platform.OS}`);
    }

    // Configure with user's profile_id as app_user_id
    await Purchases.configure({
      apiKey: apiKey,
      appUserID: userId  // profile_id becomes app_user_id in RevenueCat
    });

    // Enable debug logging in development
    if (__DEV__) {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }

    isConfigured = true;
    currentUserId = userId;
    
    console.log('RevenueCat initialized successfully');
    return true;
    
  } catch (error) {
    console.error('Failed to initialize RevenueCat:', error);
    isConfigured = false;
    return false;
  }
}

/**
 * Check if purchases are properly initialized
 * @returns {boolean} Initialization status
 */
export function isPurchasesReady() {
  return isConfigured;
}

/**
 * Get available offerings and packages from RevenueCat
 * Replaces the previous getProducts() method
 * 
 * @returns {Promise<Object>} Available offerings with packages
 */
export async function getOfferings() {
  try {
    if (!isConfigured) {
      throw new Error('RevenueCat not configured. Call initializePurchases first.');
    }

    const offerings = await Purchases.getOfferings();
    console.log('Retrieved offerings:', offerings);
    
    return offerings;
    
  } catch (error) {
    console.error('Failed to get offerings:', error);
    throw mapToPublicError(error);
  }
}

/**
 * Purchase premium insights subscription using RevenueCat
 * Maintains same interface as your existing purchasePremiumInsights()
 * 
 * @returns {Promise<Object>} Purchase result
 */
export async function purchasePremiumInsights() {
  try {
    if (!isConfigured) {
      throw new Error('RevenueCat not configured. Call initializePurchases first.');
    }

    console.log('Starting purchase flow for product_a');

    // Get offerings to find the package for product_a
    const offerings = await Purchases.getOfferings();
    
    // Find the package containing your subscription
    // RevenueCat organizes products into offerings and packages
    let packageToPurchase = null;
    
    // Search through all offerings for your product
    Object.values(offerings.all).forEach(offering => {
      offering.availablePackages.forEach(package => {
        // Match against your existing product IDs
        if (package.product.identifier === PRODUCT_IDS[Platform.OS]) {
          packageToPurchase = package;
        }
      });
    });

    if (!packageToPurchase) {
      throw new Error(`Product not found in offerings: ${PRODUCT_IDS[Platform.OS]}`);
    }

    console.log('Found package to purchase:', packageToPurchase.identifier);

    // Execute purchase through RevenueCat
    const purchaseResult = await Purchases.purchasePackage(packageToPurchase);
    
    console.log('Purchase completed:', purchaseResult);

    // Extract relevant information maintaining your interface
    const customerInfo = purchaseResult.customerInfo;
    const activeEntitlements = customerInfo.entitlements.active;

    // Check if product_a entitlement is now active
    const hasProductA = 'product_a' in activeEntitlements;
    
    if (!hasProductA) {
      // Purchase went through but entitlement not active
      // This might happen in edge cases, let webhook handle the sync
      console.warn('Purchase completed but entitlement not immediately active');
    }

    // Return success in format compatible with your existing code
    return {
      success: true,
      productId: packageToPurchase.product.identifier,
      transactionId: purchaseResult.transaction?.transactionIdentifier,
      customerInfo: customerInfo
    };
    
  } catch (error) {
    console.error('Purchase error:', error);
    
    // Transform RevenueCat errors to your existing interface
    const publicError = mapToPublicError(error);
    
    // Handle user cancellation
    if (publicError.code === PURCHASE_ERROR_TYPES.CANCELLED) {
      return { cancelled: true };
    }
    
    // Return error in your existing format
    return { error: publicError };
  }
}

/**
 * Restore previous purchases
 * Maintains interface compatibility with existing code
 * 
 * @returns {Promise<Object>} Restoration result
 */
export async function restorePurchases() {
  try {
    if (!isConfigured) {
      throw new Error('RevenueCat not configured. Call initializePurchases first.');
    }

    console.log('Restoring purchases');
    
    // RevenueCat handles the restoration automatically
    const customerInfo = await Purchases.restorePurchases();
    
    // Check if product_a entitlement is active after restoration
    const activeEntitlements = customerInfo.entitlements.active;
    const hasProductA = 'product_a' in activeEntitlements;
    
    if (hasProductA) {
      const entitlement = activeEntitlements.product_a;
      return {
        restored: true,
        expires_at: entitlement.expirationDate
      };
    } else {
      return {
        restored: false,
        message: 'No active subscriptions found'
      };
    }
    
  } catch (error) {
    console.error('Restore error:', error);
    
    const publicError = mapToPublicError(error);
    return {
      restored: false,
      error: publicError
    };
  }
}

/**
 * Get current customer info and entitlements
 * New method for checking subscription status via RevenueCat
 * 
 * @returns {Promise<Object>} Customer information
 */
export async function getCustomerInfo() {
  try {
    if (!isConfigured) {
      throw new Error('RevenueCat not configured. Call initializePurchases first.');
    }

    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
    
  } catch (error) {
    console.error('Error getting customer info:', error);
    throw mapToPublicError(error);
  }
}

/**
 * Clean up RevenueCat listeners
 * Updated for RevenueCat SDK
 */
export function cleanupPurchases() {
  // RevenueCat handles cleanup automatically
  // No manual listener cleanup required
  console.log('Purchases cleanup called');
}

/**
 * Map RevenueCat errors to your existing public error structure
 * Maintains compatibility with existing error handling
 * 
 * @param {Error} error - RevenueCat error object
 * @returns {Object} Public-facing error structure
 */
function mapToPublicError(error) {
  const publicError = {
    code: PURCHASE_ERROR_TYPES.UNKNOWN,
    message: 'An unknown error occurred'
  };

  // Map RevenueCat error codes to your existing structure
  if (error.code) {
    switch (error.code) {
      case 'USER_CANCELLED':
        publicError.code = PURCHASE_ERROR_TYPES.CANCELLED;
        publicError.message = 'Purchase was cancelled';
        break;
        
      case 'ITEM_ALREADY_OWNED':
        publicError.code = PURCHASE_ERROR_TYPES.ALREADY_OWNED;
        publicError.message = 'You already own this item';
        break;
        
      case 'STORE_PROBLEM':
        publicError.code = PURCHASE_ERROR_TYPES.CONNECTION;
        publicError.message = 'Store connection failed';
        break;
        
      case 'INVALID_PURCHASE':
        publicError.code = PURCHASE_ERROR_TYPES.SERVER;
        publicError.message = 'Purchase validation failed';
        break;
        
      default:
        publicError.message = error.message || 'Purchase failed';
    }
  } else if (error.message) {
    if (error.message.includes('network') || error.message.includes('connection')) {
      publicError.code = PURCHASE_ERROR_TYPES.CONNECTION;
      publicError.message = 'Network connection failed';
    } else {
      publicError.message = error.message;
    }
  }

  return publicError;
}

// Export the same interface your existing code expects
export default {
  initializePurchases,
  cleanupPurchases,
  getOfferings,  // Replaces getProducts
  purchasePremiumInsights,
  restorePurchases,
  getCustomerInfo,  // New method for checking subscription status
  isPurchasesReady,  // New method for checking initialization
  PURCHASE_ERROR_TYPES
};