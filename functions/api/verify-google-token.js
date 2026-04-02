/**
 * /api/verify-google-token
 * Receives a Google ID token from the frontend, verifies it with Google,
 * checks the email against the ADMIN_EMAILS whitelist, and returns success/fail.
 *
 * Required Cloudflare env vars:
 *   GOOGLE_CLIENT_ID  — OAuth client ID from Google Cloud Console
 *   ADMIN_EMAILS      — comma-separated list e.g. "gabe@gmail.com,amy@gmail.com"
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders,
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { token } = body;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // Verify the token with Google's tokeninfo endpoint
  // This is simpler than full JWT verification and reliable for admin panels
  let googleData;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    );
    googleData = await res.json();
    if (!res.ok || googleData.error) {
      return new Response(JSON.stringify({ error: 'Invalid Google token' }), {
        status: 401, headers: corsHeaders,
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Could not verify token with Google' }), {
      status: 502, headers: corsHeaders,
    });
  }

  // Confirm the token was issued for our app
  if (googleData.aud !== env.GOOGLE_CLIENT_ID) {
    return new Response(JSON.stringify({ error: 'Token audience mismatch' }), {
      status: 401, headers: corsHeaders,
    });
  }

  // Check email against whitelist
  const email = (googleData.email || '').toLowerCase().trim();
  const allowedEmails = (env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.toLowerCase().trim())
    .filter(Boolean);

  if (!allowedEmails.includes(email)) {
    return new Response(JSON.stringify({ error: 'Not authorized', email }), {
      status: 403, headers: corsHeaders,
    });
  }

  // All good — return success with the user's name and email
  return new Response(JSON.stringify({
    success: true,
    email,
    name: googleData.name || email,
    picture: googleData.picture || null,
  }), { headers: corsHeaders });
}
