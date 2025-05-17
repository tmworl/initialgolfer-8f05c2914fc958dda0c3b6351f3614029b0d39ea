// supabase/functions/revenuecat-webhook/index.ts
//
// RevenueCat webhook handler for subscription lifecycle events
// Maintains permission state integrity across subscription transitions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.31.0';
import * as crypto from "https://deno.land/std@0.168.0/crypto/mod.ts";

/**
 * Event types processed by this webhook handler
 * Each type triggers specific permission state transitions
 */
enum EventType {
  INITIAL_PURCHASE = "INITIAL_PURCHASE",
  RENEWAL = "RENEWAL",
  CANCELLATION = "CANCELLATION",
  EXPIRATION = "EXPIRATION",
  PRODUCT_CHANGE = "PRODUCT_CHANGE",
  BILLING_ISSUE = "BILLING_ISSUE",
  SUBSCRIBER_ALIAS = "SUBSCRIBER_ALIAS"
}

/**
 * Webhook event payload structure from RevenueCat
 * https://www.revenuecat.com/docs/webhooks
 */
interface WebhookEvent {
  event: {
    type: EventType;
    id: string;
    subscriber_id: string;
    app_id: string;
    original_app_user_id: string;
    product_id: string;
    entitlement_id: string;
    created_at_ms: number;
    expiration_at_ms: number | null;
    store: string;
    environment: string;
    transaction_id: string;
  };
}

/**
 * Verification result from signature validation
 */
interface VerificationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Core request handler for RevenueCat webhooks
 * 
 * Processes subscription lifecycle events from RevenueCat and
 * maintains corresponding permission state in our database.
 * 
 * Implements robust error handling, idempotent processing, and
 * comprehensive event type handling with appropriate state transitions.
 */
serve(async (req) => {
  // CORS handling for preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-RevenueCat-Signature"
      }
    });
  }

  // Only allow POST method for webhook events
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("RevenueCat webhook received");
    
    // Get webhook secret from environment
    const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
    if (!WEBHOOK_SECRET) {
      throw new Error("Webhook secret not configured");
    }
    
    // Create Supabase client with admin access for permission management
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Get request body as text for signature verification
    const body = await req.text();
    
    // Verify webhook signature
    const signature = req.headers.get("X-RevenueCat-Signature");
    const verification = await verifySignature(body, signature, WEBHOOK_SECRET);
    
    if (!verification.isValid) {
      console.error("Signature verification failed:", verification.error);
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Parse event payload
    const event: WebhookEvent = JSON.parse(body);
    console.log("Event type:", event.event.type);
    
    // Process based on event type
    const eventData = event.event;
    const userId = eventData.original_app_user_id;
    const entitlementId = eventData.entitlement_id;
    
    // Skip processing for non-production environments if needed
    if (eventData.environment !== "PRODUCTION") {
      console.log("Skipping non-production event:", eventData.environment);
      return new Response(
        JSON.stringify({ status: "skipped", reason: "non-production environment" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Process event based on type
    switch (eventData.type) {
      case EventType.INITIAL_PURCHASE:
      case EventType.RENEWAL:
        // New subscription or renewal - update permission with new expiry date
        await handleSubscriptionActivation(
          supabase,
          userId,
          entitlementId,
          eventData.product_id,
          eventData.store.toLowerCase(),
          new Date(eventData.expiration_at_ms || 0),
          eventData.transaction_id
        );
        break;
        
      case EventType.CANCELLATION:
        // User cancelled but still has access until expiration
        // Mark as cancelled in metadata but maintain access
        await handleSubscriptionCancellation(
          supabase,
          userId,
          entitlementId,
          new Date(eventData.expiration_at_ms || 0)
        );
        break;
        
      case EventType.EXPIRATION:
        // Access has expired - disable the permission
        await handleSubscriptionExpiration(
          supabase,
          userId,
          entitlementId
        );
        break;
        
      case EventType.PRODUCT_CHANGE:
        // User changed subscription tier - update with new expiry and product info
        await handleSubscriptionActivation(
          supabase,
          userId,
          entitlementId,
          eventData.product_id,
          eventData.store.toLowerCase(),
          new Date(eventData.expiration_at_ms || 0),
          eventData.transaction_id
        );
        break;
        
      case EventType.BILLING_ISSUE:
        // Payment failed - flag in metadata but don't immediately revoke access
        // RevenueCat will send EXPIRATION when grace period ends
        await handleBillingIssue(
          supabase,
          userId,
          entitlementId
        );
        break;
        
      default:
        console.log("Unhandled event type:", eventData.type);
    }
    
    // Return success response
    return new Response(
      JSON.stringify({ 
        status: "processed",
        event_type: eventData.type
      }),
      { headers: { "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("Error processing webhook:", error);
    
    return new Response(
      JSON.stringify({ 
        status: "error",
        message: "Server error processing webhook"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Verify webhook signature to ensure request authenticity
 * 
 * Uses HMAC SHA-256 to validate the request came from RevenueCat
 * 
 * @param body - Raw request body
 * @param signature - X-RevenueCat-Signature header value
 * @param secret - Webhook secret from RevenueCat dashboard
 * @returns Verification result with validity status
 */
async function verifySignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<VerificationResult> {
  if (!signature) {
    return { isValid: false, error: "Missing signature header" };
  }
  
  try {
    // Convert secret to key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    
    // Calculate expected signature
    const bodyData = encoder.encode(body);
    const signatureData = await crypto.subtle.sign(
      "HMAC",
      key,
      bodyData
    );
    
    // Convert to hex string for comparison
    const signatureHex = Array.from(new Uint8Array(signatureData))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare with provided signature
    return { isValid: signature === signatureHex };
    
  } catch (error) {
    console.error("Signature verification error:", error);
    return { isValid: false, error: "Signature verification failed" };
  }
}

/**
 * Handle subscription activation events (initial purchase or renewal)
 * 
 * Updates permission record with subscription details and new expiry date
 * 
 * @param supabase - Supabase client
 * @param userId - User's profile ID
 * @param entitlementId - Entitlement identifier (maps to permission_id)
 * @param productId - Platform-specific product identifier
 * @param platform - 'app_store' or 'play_store'
 * @param expiresAt - Subscription expiration date
 * @param transactionId - Store transaction identifier
 */
async function handleSubscriptionActivation(
  supabase: any,
  userId: string,
  entitlementId: string,
  productId: string,
  platform: string,
  expiresAt: Date,
  transactionId: string
) {
  try {
    console.log(`Activating subscription for user ${userId}, expires ${expiresAt.toISOString()}`);
    
    // Update or insert permission record
    const { error } = await supabase
      .from('user_permissions')
      .upsert({
        profile_id: userId,
        permission_id: entitlementId,
        active: true,
        expires_at: expiresAt.toISOString(),
        product_id: productId,
        platform: platform,
        revenuecat_user_id: userId,
        metadata: {
          transaction_id: transactionId,
          updated_at: new Date().toISOString(),
          status: 'active',
          source: 'webhook'
        }
      });
    
    if (error) {
      console.error("Error updating permission:", error);
      throw error;
    }
    
    console.log(`Subscription activated for user ${userId}`);
    
  } catch (error) {
    console.error("Error in handleSubscriptionActivation:", error);
    throw error;
  }
}

/**
 * Handle subscription cancellation events
 * 
 * Updates permission metadata to reflect cancellation but maintains
 * access until the expiration date
 * 
 * @param supabase - Supabase client
 * @param userId - User's profile ID
 * @param entitlementId - Entitlement identifier (maps to permission_id)
 * @param expiresAt - Final expiration date after which access is removed
 */
async function handleSubscriptionCancellation(
  supabase: any,
  userId: string,
  entitlementId: string,
  expiresAt: Date
) {
  try {
    console.log(`Cancelling subscription for user ${userId}, expires ${expiresAt.toISOString()}`);
    
    // Get existing record to preserve metadata
    const { data: existingPermission, error: fetchError } = await supabase
      .from('user_permissions')
      .select('*')
      .eq('profile_id', userId)
      .eq('permission_id', entitlementId)
      .maybeSingle();
    
    if (fetchError) {
      console.error("Error fetching existing permission:", fetchError);
      throw fetchError;
    }
    
    // Prepare updated metadata
    const existingMetadata = existingPermission?.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      source: 'webhook'
    };
    
    // Update permission record - keep active until expiration
    const { error } = await supabase
      .from('user_permissions')
      .upsert({
        profile_id: userId,
        permission_id: entitlementId,
        active: true, // Still active until expiration
        expires_at: expiresAt.toISOString(),
        metadata: updatedMetadata
      });
    
    if (error) {
      console.error("Error updating cancelled permission:", error);
      throw error;
    }
    
    console.log(`Subscription cancellation processed for user ${userId}`);
    
  } catch (error) {
    console.error("Error in handleSubscriptionCancellation:", error);
    throw error;
  }
}

/**
 * Handle subscription expiration events
 * 
 * Deactivates the permission record to revoke access to premium features
 * 
 * @param supabase - Supabase client
 * @param userId - User's profile ID
 * @param entitlementId - Entitlement identifier (maps to permission_id)
 */
async function handleSubscriptionExpiration(
  supabase: any,
  userId: string,
  entitlementId: string
) {
  try {
    console.log(`Processing expiration for user ${userId}`);
    
    // Get existing record to preserve metadata
    const { data: existingPermission, error: fetchError } = await supabase
      .from('user_permissions')
      .select('*')
      .eq('profile_id', userId)
      .eq('permission_id', entitlementId)
      .maybeSingle();
    
    if (fetchError) {
      console.error("Error fetching existing permission:", fetchError);
      throw fetchError;
    }
    
    // Prepare updated metadata
    const existingMetadata = existingPermission?.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      status: 'expired',
      expired_at: new Date().toISOString(),
      source: 'webhook'
    };
    
    // Update permission record - deactivate permission
    const { error } = await supabase
      .from('user_permissions')
      .upsert({
        profile_id: userId,
        permission_id: entitlementId,
        active: false, // No longer active
        expires_at: existingPermission?.expires_at || null,
        metadata: updatedMetadata
      });
    
    if (error) {
      console.error("Error deactivating expired permission:", error);
      throw error;
    }
    
    console.log(`Subscription expired for user ${userId}`);
    
  } catch (error) {
    console.error("Error in handleSubscriptionExpiration:", error);
    throw error;
  }
}

/**
 * Handle billing issue events
 * 
 * Flags permission record with billing issue status but maintains
 * access during grace period
 * 
 * @param supabase - Supabase client
 * @param userId - User's profile ID
 * @param entitlementId - Entitlement identifier (maps to permission_id)
 */
async function handleBillingIssue(
  supabase: any,
  userId: string,
  entitlementId: string
) {
  try {
    console.log(`Processing billing issue for user ${userId}`);
    
    // Get existing record to preserve metadata and expiration
    const { data: existingPermission, error: fetchError } = await supabase
      .from('user_permissions')
      .select('*')
      .eq('profile_id', userId)
      .eq('permission_id', entitlementId)
      .maybeSingle();
    
    if (fetchError) {
      console.error("Error fetching existing permission:", fetchError);
      throw fetchError;
    }
    
    if (!existingPermission) {
      console.log(`No existing permission found for user ${userId}`);
      return;
    }
    
    // Prepare updated metadata
    const existingMetadata = existingPermission.metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      billing_issue: true,
      billing_issue_detected_at: new Date().toISOString(),
      source: 'webhook'
    };
    
    // Update permission record - maintain access during grace period
    const { error } = await supabase
      .from('user_permissions')
      .upsert({
        profile_id: userId,
        permission_id: entitlementId,
        active: true, // Still active during grace period
        expires_at: existingPermission.expires_at,
        metadata: updatedMetadata
      });
    
    if (error) {
      console.error("Error updating permission with billing issue:", error);
      throw error;
    }
    
    console.log(`Billing issue recorded for user ${userId}`);
    
  } catch (error) {
    console.error("Error in handleBillingIssue:", error);
    throw error;
  }
}