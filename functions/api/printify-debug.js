// TEMPORARY - delete this file after getting shop ID and variant shape
export async function onRequest(context) {
  var env = context.env;

  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (!env.PRINTIFY_API_KEY) {
    return new Response(JSON.stringify({ error: 'PRINTIFY_API_KEY not set in env vars' }), { headers: corsHeaders });
  }

  var headers = {
    'Authorization': 'Bearer ' + env.PRINTIFY_API_KEY,
    'Content-Type': 'application/json',
    'User-Agent': 'FriedasCafe/1.0',
  };

  try {
    // Step 1: get shops
    var shopsRes = await fetch('https://api.printify.com/v1/shops.json', { headers: headers });
    var shops = await shopsRes.json();

    if (!shopsRes.ok) {
      return new Response(JSON.stringify({ error: 'Shops call failed', detail: shops }), { headers: corsHeaders });
    }

    var shopId = shops[0] && shops[0].id;
    if (!shopId) {
      return new Response(JSON.stringify({ shops: shops, error: 'No shops found' }), { headers: corsHeaders });
    }

    // Step 2: get first product to inspect variant shape
    var productsRes = await fetch(
      'https://api.printify.com/v1/shops/' + shopId + '/products.json?limit=1',
      { headers: headers }
    );
    var productsData = await productsRes.json();
    var firstProduct = productsData.data && productsData.data[0];

    return new Response(JSON.stringify({
      shops: shops,
      shop_id: shopId,
      first_product_title: firstProduct && firstProduct.title,
      first_product_options: firstProduct && firstProduct.options,
      first_variant_sample: firstProduct && firstProduct.variants && firstProduct.variants.slice(0, 3),
      first_image_sample: firstProduct && firstProduct.images && firstProduct.images.slice(0, 2),
    }, null, 2), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders, status: 500 });
  }
}
