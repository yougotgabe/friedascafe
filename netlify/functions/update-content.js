// netlify/functions/update-content.js
// Called by the admin panel to update site_content rows in Supabase
// Protected by a simple admin password stored as a Netlify env var

const https = require('https');

function supabaseRequest(path, method, body, serviceRoleKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(supabaseUrl + path);
    const data = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': 'Bearer ' + serviceRoleKey,
        'Prefer': 'resolution=merge-duplicates'
      }
    };

    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, body: responseData });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// The keys that are allowed to be updated via the admin panel
// This prevents someone from injecting arbitrary keys into the database
const ALLOWED_KEYS = [
  'hours_weekday',
  'hours_saturday',
  'hours_sunday',
  'holiday_notice_active',
  'holiday_notice_text',
  'hero_photo_url',
  'payment_note'
];

exports.handler = async function(event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // CORS headers so the admin page can call this from the browser
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Grab env vars
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD) {
    console.error('Missing required environment variables');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Parse request body
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  // Check admin password
  if (!payload.password || payload.password !== ADMIN_PASSWORD) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  // Expect payload.updates to be an object like:
  // { hours_weekday: '6am - 4pm', holiday_notice_active: 'true', ... }
  const updates = payload.updates;
  if (!updates || typeof updates !== 'object') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing updates object' })
    };
  }

  // Filter to only allowed keys
  const validKeys = Object.keys(updates).filter(k => ALLOWED_KEYS.includes(k));
  if (validKeys.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'No valid keys to update' })
    };
  }

  // Build array of upsert rows
  const rows = validKeys.map(key => ({
    key: key,
    value: String(updates[key])
  }));

  console.log('Updating site_content rows:', rows);

  // Upsert all rows in one request
  const result = await supabaseRequest(
    '/rest/v1/site_content',
    'POST',
    rows,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL
  );

  console.log('Supabase response:', result.status, JSON.stringify(result.body));

  if (result.status >= 400) {
    console.error('Supabase error:', result.body);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update content', details: result.body })
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, updated: validKeys })
  };
};
