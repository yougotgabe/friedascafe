/**
 * admin-auth.js — shared auth helper
 *
 * Verifies a Google ID token. On the first call we hit Google's tokeninfo
 * endpoint for full validation. On subsequent calls within the same Worker
 * instance we decode the JWT locally and check the exp claim — this avoids
 * hammering Google's endpoint on every admin API call and prevents the
 * race-condition where loadMenuItems / loadOrders fire a split-second after
 * get-content and get rate-limited or see a stale tokeninfo response.
 *
 * Usage:
 *   import { verifyAdminToken } from './admin-auth.js';
 *   const authError = await verifyAdminToken(request, env, corsHeaders);
 *   if (authError) return authError;
 */

// Module-level cache: token string -> { email, exp }
// Survives for the lifetime of this Worker instance (typically minutes).
var tokenCache = {};

function decodeJwtPayload(token) {
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    var padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4);
    var json = atob(padded);
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export async function verifyAdminToken(request, env, corsHeaders) {
  var token = request.headers.get('x-google-token');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  var nowSec = Math.floor(Date.now() / 1000);

  // Fast path: token already validated this Worker instance
  var cached = tokenCache[token];
  if (cached && cached.exp > nowSec + 30) {
    return null;
  }

  // If the token is locally expired, reject immediately without hitting Google
  var payload = decodeJwtPayload(token);
  if (payload && payload.exp && payload.exp <= nowSec) {
    return new Response(JSON.stringify({ error: 'Token expired' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  // Full verification via Google tokeninfo
  try {
    var res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + token
    );
    var data = await res.json();

    if (!res.ok || data.error) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    if (data.aud !== env.GOOGLE_CLIENT_ID) {
      return new Response(JSON.stringify({ error: 'Token audience mismatch' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    var email = (data.email || '').toLowerCase().trim();
    var allowedEmails = (env.ADMIN_EMAILS || '')
      .split(',')
      .map(function(e) { return e.toLowerCase().trim(); })
      .filter(Boolean);

    if (!allowedEmails.includes(email)) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Cache successful result
    tokenCache[token] = { email: email, exp: parseInt(data.exp) || (nowSec + 3600) };

    // Prune stale entries
    Object.keys(tokenCache).forEach(function(k) {
      if (tokenCache[k].exp <= nowSec) delete tokenCache[k];
    });

    return null;

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Auth verification failed' }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}
