export async function onRequest(context) {
  var env = context.env;

  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.PRINTIFY_API_KEY || !env.PRINTIFY_SHOP_ID) {
    return new Response(JSON.stringify({ error: 'Printify env vars not configured', products: [] }), {
      headers: corsHeaders,
    });
  }

  var printifyHeaders = {
    'Authorization': 'Bearer ' + env.PRINTIFY_API_KEY,
    'Content-Type': 'application/json',
    'User-Agent': 'FriedasCafe/1.0',
  };

  try {
    // Fetch all published products (up to 100)
    var res = await fetch(
      'https://api.printify.com/v1/shops/' + env.PRINTIFY_SHOP_ID + '/products.json?limit=50',
      { headers: printifyHeaders }
    );

    if (!res.ok) {
      var errText = await res.text();
      return new Response(JSON.stringify({ error: 'Printify error', detail: errText, products: [] }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    var data = await res.json();
    var rawProducts = data.data || [];

    // Normalize each product into a clean shape for the frontend
    var products = rawProducts
      .filter(function(p) { return p.visible !== false; })
      .map(function(p) {
        // Build a lookup: option value ID -> { title, colors }
        var optionValueMap = {};
        var optionGroups = []; // [{ name, type, values: [{ id, title, colors }] }]

        (p.options || []).forEach(function(opt) {
          var group = {
            name: opt.name,
            type: opt.type, // 'color', 'size', etc.
            values: [],
          };
          (opt.values || []).forEach(function(val) {
            optionValueMap[val.id] = { title: val.title, colors: val.colors || [] };
            group.values.push({ id: val.id, title: val.title, colors: val.colors || [] });
          });
          optionGroups.push(group);
        });

        // Normalize variants — only enabled + available ones
        var variants = (p.variants || [])
          .filter(function(v) { return v.is_enabled && v.is_available; })
          .map(function(v) {
            // Resolve option IDs to human-readable labels
            var resolvedOptions = (v.options || []).map(function(optId) {
              return optionValueMap[optId] || { title: String(optId), colors: [] };
            });
            return {
              id: v.id,
              sku: v.sku,
              title: v.title,
              price: v.price,          // cents
              is_default: v.is_default,
              options: v.options,       // raw IDs, for matching
              resolvedOptions: resolvedOptions, // [{ title, colors }]
            };
          });

        // Base price = cheapest enabled variant
        var prices = variants.map(function(v) { return v.price; });
        var basePrice = prices.length ? Math.min.apply(null, prices) : 0;

        // Images — keep only selected_for_publishing ones
        var images = (p.images || [])
          .filter(function(img) { return img.is_selected_for_publishing; })
          .map(function(img) {
            return {
              src: img.src,
              is_default: img.is_default,
              variant_ids: img.variant_ids || [],
              position: img.position,
            };
          });

        return {
          id: p.id,
          name: p.title,
          description: p.description || '',
          price_cents: basePrice,
          options: optionGroups,       // structured option groups with values + hex codes
          variants: variants,
          images: images,
        };
      });

    return new Response(JSON.stringify({ products: products }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, products: [] }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
