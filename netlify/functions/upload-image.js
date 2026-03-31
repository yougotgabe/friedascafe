// netlify/functions/upload-image.js
// Accepts a base64-encoded image, uploads to Supabase Storage,
// then saves the public URL to site_content

const https = require('https');

function supabaseRequest(hostname, path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const options = { hostname, path, method, headers };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        try { resolve({ status: res.statusCode, body: JSON.parse(raw.toString()) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw.toString() }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// All valid content keys for image uploads
// gallery_image_1 through gallery_image_20 for the slideshow
const LEGACY_KEYS = ['story_image_url', 'menu_image_url', 'staff_image_url'];
const GALLERY_KEYS = Array.from({length: 20}, (_, i) => 'gallery_image_' + (i + 1));
const ALLOWED_CONTENT_KEYS = LEGACY_KEYS.concat(GALLERY_KEYS);

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!payload.password || payload.password !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { contentKey, imageData, mimeType } = payload;

  if (!ALLOWED_CONTENT_KEYS.includes(contentKey)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid content key' }) };
  }
  if (!ALLOWED_TYPES[mimeType]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid image type. Use JPEG, PNG, or WebP.' }) };
  }
  if (!imageData) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image data provided' }) };
  }

  const imageBuffer = Buffer.from(imageData, 'base64');
  const ext = ALLOWED_TYPES[mimeType];
  const filename = contentKey + '-' + Date.now() + '.' + ext;
  const supabaseHostname = new URL(SUPABASE_URL).hostname;

  // Upload to Supabase Storage
  const uploadResult = await supabaseRequest(
    supabaseHostname,
    '/storage/v1/object/site-images/' + filename,
    'POST',
    imageBuffer,
    {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': mimeType,
      'x-upsert': 'true'
    }
  );

  if (uploadResult.status >= 400) {
    console.error('Storage upload failed:', uploadResult.body);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Image upload failed', details: uploadResult.body }) };
  }

  const publicUrl = SUPABASE_URL + '/storage/v1/object/public/site-images/' + filename;

  // Save the URL to site_content
  const saveResult = await supabaseRequest(
    supabaseHostname,
    '/rest/v1/site_content',
    'POST',
    [{ key: contentKey, value: publicUrl }],
    {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    }
  );

  if (saveResult.status >= 400) {
    console.error('site_content save failed:', saveResult.body);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save image URL' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, url: publicUrl }) };
};
