// supabase/functions/track-analytics/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Configuration constants
const POSTHOG_API_KEY = Deno.env.get("POSTHOG_API_KEY");
const POSTHOG_API_HOST = "https://eu.i.posthog.com";

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
      return new Response(
        JSON.stringify({ error: "Missing required event data" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Forward to PostHog with API key
    const response = await fetch(`${POSTHOG_API_HOST}/capture/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: POSTHOG_API_KEY,
        event: payload.event,
        properties: payload.properties
      })
    });
    
    if (!response.ok) {
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