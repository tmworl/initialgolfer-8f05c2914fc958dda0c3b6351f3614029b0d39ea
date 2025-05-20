// supabase/functions/track-analytics/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Configuration constants
const POSTHOG_API_KEY = Deno.env.get("POSTHOG_API_KEY");
const POSTHOG_API_HOST = "https://eu.i.posthog.com";
const POSTHOG_CAPTURE_ENDPOINT = "/i/v0/e/"; // Correct API endpoint

if (!POSTHOG_API_KEY) {
  console.error("Missing POSTHOG_API_KEY environment variable");
}

serve(async (req) => {
  // Handle CORS for preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  
  try {
    // Parse request body
    const payload = await req.json();
    
    // Simple validation
    if (!payload.event || !payload.properties) {
      console.error("Missing required event data", payload);
      return new Response(
        JSON.stringify({ error: "Missing required event data" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Extract distinct_id from properties or use the top-level one if provided
    const distinct_id = payload.distinct_id || payload.properties.distinct_id || 'anonymous';
    
    // Construct PostHog-compatible payload
    const postHogPayload = {
      api_key: POSTHOG_API_KEY,
      event: payload.event,
      distinct_id: distinct_id,
      properties: payload.properties,
      ...(payload.timestamp ? { timestamp: payload.timestamp } : {})
    };
    
    console.log(`Sending to PostHog: ${payload.event} for ${distinct_id}`);
    
    // Forward to PostHog with the correct API endpoint
    const response = await fetch(`${POSTHOG_API_HOST}${POSTHOG_CAPTURE_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postHogPayload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`PostHog API error: ${response.status}`, errorText);
      throw new Error(`PostHog API error: ${response.status}`);
    }
    
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.error("Error processing analytics event:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});