// src/services/purchaseService.js
//
// Client-side purchase service for in-app purchases
// Handles platform-specific implementations, receipt capture, and server communication

import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap'; // Note: We would need to add this dependency to package.json
import { supabase } from './supabase';

// Platform-specific product identifiers
const PRODUCT_IDS = {
  ios: ['com.daybeam.golfimprove.product_a'],
  android: ['com.daybeam.golfimprove.product_a']
};

// Subscription product for premium insights
const PREMIUM_INSIGHTS_PRODUCT = Platform.select({
  ios: 'com.daybeam.golfimprove.product_a',
  android: 'com.daybeam.golfimprove.product_a'
});

// Error types for structured error handling
export const PURCHASE_ERROR_TYPES = {
  CONNECTION: 'connection_error',
  CANCELLED: 'user_cancelled',
  ALREADY_OWNED: 'already_owned',
  NOT_ALLOWED: 'not_allowed',
  UNKNOWN: 'unknown_error',
  SERVER: 'server_error'
};

/**
 * Initialize the IAP module
 * Must be called before any other IAP operations
 */
export async function initializePurchases() {
  try {
    await RNIap.initConnection();
    console.log('IAP connection initialized');
    
    // Enable purchase updates listener
    purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(handlePurchaseUpdate);
    purchaseErrorSubscription = RNIap.purchaseErrorListener(handlePurchaseError);
    
    return true;
  } catch (error) {
    console.error('Failed to initialize IAP connection:', error);
    return false;
  }
}

/**
 * Clean up IAP listeners
 * Should be called when the app unmounts to prevent memory leaks
 */
export function cleanupPurchases() {
  if (purchaseUpdateSubscription) {
    purchaseUpdateSubscription.remove();
    purchaseUpdateSubscription = null;
  }
  
  if (purchaseErrorSubscription) {
    purchaseErrorSubscription.remove();
    purchaseErrorSubscription = null;
  }
  
  // End connection when app is closed
  RNIap.endConnection();
}

// Subscription references for event listeners
let purchaseUpdateSubscription = null;
let purchaseErrorSubscription = null;

/**
 * Get available products from the store
 * Useful for displaying product information before purchase
 * 
 * @returns {Promise<Array>} Available products with price, description, etc.
 */
export async function getProducts() {
  try {
    const products = await RNIap.getProducts(PRODUCT_IDS[Platform.OS]);
    return products;
  } catch (error) {
    console.error('Failed to get products:', error);
    throw mapToPublicError(error);
  }
}

/**
 * Request purchase of premium insights subscription
 * 
 * @returns {Promise<Object>} Purchase result with subscription details
 */
export async function purchasePremiumInsights() {
  try {
    // 1. Platform-specific purchase request
    let receipt;
    let purchaseToken;
    
    if (Platform.OS === 'ios') {
      // iOS-specific purchase flow
      const result = await RNIap.requestPurchase(PREMIUM_INSIGHTS_PRODUCT);
      receipt = result.transactionReceipt;
    } else {
      // Android-specific purchase flow
      const result = await RNIap.requestPurchase(PREMIUM_INSIGHTS_PRODUCT);
      purchaseToken = result.purchaseToken;
      receipt = purchaseToken; // For consistency in our API calls
    }
    
    // 2. Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    // 3. Validate purchase with server
    const validationResult = await validatePurchaseWithServer(
      receipt,
      PREMIUM_INSIGHTS_PRODUCT,
      user.id,
      Platform.OS
    );
    
    // If server validation failed, throw error
    if (!validationResult.success) {
      throw new Error(validationResult.error || 'Purchase validation failed');
    }
    
    // Return successful result
    return {
      success: true,
      expires_at: validationResult.expires_at,
      product_id: PREMIUM_INSIGHTS_PRODUCT
    };
    
  } catch (error) {
    console.error('Purchase error:', error);
    
    // Transform error to public-facing structure
    const publicError = mapToPublicError(error);
    
    // If user cancelled, return cancelled flag instead of error
    if (publicError.code === PURCHASE_ERROR_TYPES.CANCELLED) {
      return { cancelled: true };
    }
    
    // Otherwise, return error structure
    return { error: publicError };
  }
}

/**
 * Validate purchase receipt with server
 * 
 * @param {string} receipt - Purchase receipt (iOS) or purchase token (Android)
 * @param {string} productId - Product identifier
 * @param {string} userId - User's profile ID
 * @param {string} platform - 'ios' or 'android'
 * @returns {Promise<Object>} Validation result
 */
async function validatePurchaseWithServer(receipt, productId, userId, platform) {
  try {
    // Call our serverless function to validate the purchase
    const { data, error } = await supabase.functions.invoke('process-purchase', {
      body: { 
        receipt, 
        platform,
        userId,
        productId
      }
    });
    
    if (error) throw error;
    return data;
    
  } catch (error) {
    console.error('Server validation error:', error);
    return { 
      success: false, 
      error: 'Server validation failed' 
    };
  }
}

/**
 * Restore previous purchases
 * 
 * @returns {Promise<Object>} Restoration result
 */
export async function restorePurchases() {
  try {
    // Get available purchases from the store
    let purchases;
    if (Platform.OS === 'ios') {
      purchases = await RNIap.getAvailablePurchases();
    } else {
      purchases = await RNIap.getAvailablePurchases();
    }
    
    // Filter for our premium product
    const premiumPurchase = purchases.find(
      purchase => purchase.productId === PREMIUM_INSIGHTS_PRODUCT
    );
    
    // If no premium purchase found, return early
    if (!premiumPurchase) {
      return { restored: false, message: 'No previous purchases found' };
    }
    
    // Get current user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    // Extract receipt based on platform
    let receipt;
    if (Platform.OS === 'ios') {
      receipt = premiumPurchase.transactionReceipt;
    } else {
      receipt = premiumPurchase.purchaseToken;
    }
    
    // Validate with server
    const validationResult = await validatePurchaseWithServer(
      receipt,
      PREMIUM_INSIGHTS_PRODUCT,
      user.id,
      Platform.OS
    );
    
    if (!validationResult.success) {
      return { 
        restored: false, 
        error: validationResult.error || 'Restoration validation failed' 
      };
    }
    
    return { 
      restored: true, 
      expires_at: validationResult.expires_at 
    };
    
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
 * Handle purchase update event
 * Called by RNIap's purchaseUpdatedListener
 * 
 * @param {Object} purchase - Purchase object from RNIap
 */
function handlePurchaseUpdate(purchase) {
  console.log('Purchase updated:', purchase);
  
  // For consumables, finalize the purchase
  if (purchase.productId !== PREMIUM_INSIGHTS_PRODUCT) {
    RNIap.finishTransaction(purchase);
  }
}

/**
 * Handle purchase error event
 * Called by RNIap's purchaseErrorListener
 * 
 * @param {Object} error - Error object from RNIap
 */
function handlePurchaseError(error) {
  console.error('Purchase error listener:', error);
}

/**
 * Map RNIap or network errors to public-facing error structure
 * 
 * @param {Error} error - Internal error object
 * @returns {Object} Public-facing error structure
 */
function mapToPublicError(error) {
  // Default error structure
  const publicError = {
    code: PURCHASE_ERROR_TYPES.UNKNOWN,
    message: 'An unknown error occurred'
  };
  
  // Process specific error codes from RNIap
  if (error.code) {
    switch(error.code) {
      case 'E_USER_CANCELLED':
        publicError.code = PURCHASE_ERROR_TYPES.CANCELLED;
        publicError.message = 'Purchase was cancelled';
        break;
        
      case 'E_ALREADY_OWNED':
        publicError.code = PURCHASE_ERROR_TYPES.ALREADY_OWNED;
        publicError.message = 'You already own this item';
        break;
        
      case 'E_NOT_PREPARED':
        publicError.code = PURCHASE_ERROR_TYPES.CONNECTION;
        publicError.message = 'Store connection failed';
        break;
        
      case 'E_REMOTE_ERROR':
        publicError.code = PURCHASE_ERROR_TYPES.SERVER;
        publicError.message = 'Server validation failed';
        break;
        
      default:
        publicError.message = error.message || 'Purchase failed';
    }
  } else if (error.message) {
    // Handle network or other errors
    if (error.message.includes('network')) {
      publicError.code = PURCHASE_ERROR_TYPES.CONNECTION;
      publicError.message = 'Network connection failed';
    } else {
      publicError.message = error.message;
    }
  }
  
  return publicError;
}

export default {
  initializePurchases,
  cleanupPurchases,
  getProducts,
  purchasePremiumInsights,
  restorePurchases,
  PURCHASE_ERROR_TYPES
};