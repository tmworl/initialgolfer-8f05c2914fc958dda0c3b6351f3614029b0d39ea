// supabase/functions/process-purchase/index.ts
//
// Server-side purchase validation endpoint
// Validates receipts with RevenueCat API and updates permission records

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.31.0';

// Define payload type for request validation
interface RequestPayload {
  receipt: string;         // Platform-specific receipt data (transactionReceipt for iOS, purchaseToken for Android)
  platform: string;        // 'ios' or 'android'
  userId: string;          // User's profile ID
  productId: string;       // Platform-specific product identifier
}

// Define validation result structure
interface ValidationResult {
  success: boolean;
  expires_at?: string;
  entitlement_id?: string;
  original_transaction_id?: string;
  error?: string;
}

/**
 * Core request handler for purchase validation
 * 
 * Receives purchase receipts from clients, validates with RevenueCat,
 * and updates user_permissions table with entitlements.
 * 
 * Implements idempotent processing and proper error handling with
 * defensive coding practices throughout.
 */
serve(async (req) => {
  // CORS handling for preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  // Only allow POST method for security
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Purchase validation endpoint called");
    
    // Get RevenueCat API key from environment
    const REVENUECAT_API_KEY = Deno.env.get("REVENUECAT_API_KEY");
    if (!REVENUECAT_API_KEY) {
      throw new Error("RevenueCat API key not configured");
    }
    
    // Create Supabase client with admin access
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Parse request payload
    const payload: RequestPayload = await req.json();
    
    // Validate required fields
    const { receipt, platform, userId, productId } = payload;
    if (!receipt || !platform || !userId || !productId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required parameters" 
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    console.log(`Processing ${platform} purchase for user ${userId}`);
    
    // Check for existing valid permission to prevent duplicate processing
    const { data: existingPermission, error: permissionError } = await supabase
      .from('user_permissions')
      .select('*')
      .eq('profile_id', userId)
      .eq('permission_id', 'product_a')
      .eq('active', true)
      .maybeSingle();
      
    if (permissionError) {
      console.error("Error checking existing permissions:", permissionError);
    } else if (existingPermission) {
      const now = new Date();
      const expiryDate = new Date(existingPermission.expires_at);
      
      // If user already has an active subscription with future expiry, this could be a duplicate
      // Return success with existing expiry date to maintain idempotency
      if (expiryDate > now && existingPermission.product_id === productId) {
        console.log("User already has valid subscription, returning existing data");
        return new Response(
          JSON.stringify({ 
            success: true, 
            expires_at: existingPermission.expires_at,
            message: "Existing subscription found"
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
    }
    
    // Validate receipt with RevenueCat
    const validationResult = await validateReceiptWithRevenueCat(
      receipt, 
      platform, 
      userId, 
      REVENUECAT_API_KEY
    );
    
    console.log("Validation result:", validationResult);
    
    if (!validationResult.success) {
      return new Response(
        JSON.stringify(validationResult),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Receipt is valid, update permissions
    const { error: upsertError } = await supabase
      .from('user_permissions')
      .upsert({
        profile_id: userId,
        permission_id: 'product_a',
        active: true,
        expires_at: validationResult.expires_at,
        product_id: productId,
        platform: platform,
        revenuecat_user_id: userId, // Using userId as the RevenueCat ID for simplicity
        metadata: {
          transaction_id: validationResult.original_transaction_id,
          purchase_date: new Date().toISOString(),
          store: platform === 'ios' ? 'app_store' : 'play_store',
          verification_timestamp: new Date().toISOString()
        }
      });
    
    if (upsertError) {
      console.error("Error updating permissions:", upsertError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Failed to update permission record" 
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Return successful response
    return new Response(
      JSON.stringify({ 
        success: true, 
        expires_at: validationResult.expires_at
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error processing purchase:", error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Server error processing purchase" 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Validates a purchase receipt with RevenueCat API
 * 
 * @param receipt - Platform-specific receipt data
 * @param platform - 'ios' or 'android'
 * @param userId - User's profile ID
 * @param apiKey - RevenueCat API key
 * @returns Validation result with success status and expiration date
 */
async function validateReceiptWithRevenueCat(
  receipt: string, 
  platform: string, 
  userId: string, 
  apiKey: string
): Promise<ValidationResult> {
  try {
    // Prepare request body - format differs by platform
    const requestBody: any = {
      app_user_id: userId,
    };
    
    // iOS uses 'fetch_token', Android uses 'product_id' and 'purchase_token'
    if (platform === 'ios') {
      requestBody.fetch_token = receipt;
    } else if (platform === 'android') {
      // For Android, the receipt is the purchase token
      requestBody.purchase_token = receipt;
    } else {
      return { 
        success: false, 
        error: `Unsupported platform: ${platform}` 
      };
    }
    
    // Call RevenueCat API
    const response = await fetch('https://api.revenuecat.com/v1/receipts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Platform': platform
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("RevenueCat API error:", response.status, errorText);
      
      return { 
        success: false, 
        error: `RevenueCat validation failed: ${response.status}` 
      };
    }
    
    const validation = await response.json();
    
    // Check for product_a entitlement
    if (validation.subscriber?.entitlements?.product_a) {
      const entitlement = validation.subscriber.entitlements.product_a;
      const productIdentifier = Object.keys(validation.subscriber.subscriptions)[0];
      const subscription = validation.subscriber.subscriptions[productIdentifier];
      
      return { 
        success: true, 
        expires_at: entitlement.expires_date,
        entitlement_id: 'product_a', 
        original_transaction_id: subscription?.original_transaction_id
      };
    }
    
    return { 
      success: false, 
      error: 'No valid entitlement found' 
    };
    
  } catch (error) {
    console.error("Error validating with RevenueCat:", error);
    return { 
      success: false, 
      error: `Validation error: ${error.message}` 
    };
  }
}