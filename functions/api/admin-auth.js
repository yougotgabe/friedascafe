/**
 * admin-auth.js — shared auth helper
 * Import this in any admin-only API function.
 *
 * Usage:
 *   import { verifyAdminToken } from './admin-auth.js';
 *   const authError = await verifyAdminToken(request, env);
 *   if (authError) return authError;
 */

export async function verifyAdminToken(request, env, corsHeaders) {
  const token = request.headers.get('x-google-token');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: corsHeaders,
      });
    }

    if (data.aud !== env.GOOGLE_CLIENT_ID) {
      return new Response(JSON.stringify({ error: 'Token audience mismatch' }), {
        status: 401, headers: corsHeaders,
      });
    }

    const email = (data.email || '').toLowerCase().trim();
    const allowedEmails = (env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.toLowerCase().trim())
      .filter(Boolean);

    if (!allowedEmails.includes(email)) {
      return new Response(JSON.stringify({ error: 'Not authorized' }), {
        status: 403, headers: corsHeaders,
      });
    }

    // Auth passed — return null (no error)
    return null;

  } catch {
    return new Response(JSON.stringify({ error: 'Auth verification failed' }), {
      status: 502, headers: corsHeaders,
    });
  }
}
