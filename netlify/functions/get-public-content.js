// netlify/functions/get-public-content.js
// Returns public site_content rows (hours, holiday notice, payment note) for frontend pages.
// No password required — uses service role key server-side so no keys live in the HTML.

const https = require('https');

function supabaseRequest(path, serviceRoleKey, supabaseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(supabaseUrl + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': 'Bearer ' + serviceRoleKey
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  // Only expose the keys that are safe to be public
  // Base keys + up to 20 gallery image slots
  const baseKeys = [
    'hours_weekday', 'hours_saturday', 'hours_sunday',
    'holiday_notice_active', 'holiday_notice_text', 'payment_note',
    'story_image_url', 'menu_image_url', 'staff_image_url'
  ];
  const galleryKeys = Array.from({length: 20}, (_, i) => 'gallery_image_' + (i + 1));
  const allowedKeys = baseKeys.concat(galleryKeys);

  const keyFilter = allowedKeys.map(k => `key.eq.${k}`).join(',');
  const result = await supabaseRequest(
    `/rest/v1/site_content?select=key,value&or=(${keyFilter})`,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL
  );

  if (result.status >= 400) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch content' }) };
  }

  var content = {};
  result.body.forEach(function(row) { content[row.key] = row.value; });

  return { statusCode: 200, headers, body: JSON.stringify({ content: content }) };
};
