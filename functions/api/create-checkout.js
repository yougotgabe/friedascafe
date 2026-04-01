import Stripe from 'stripe';

export const onRequest = async (context) => {
  try {
    const stripe = new Stripe(context.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });

    const body = await context.request.json();
    const cart = body.cart || [];

    if (!cart.length) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), {
        status: 400,
      });
    }

    const line_items = cart.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          images: item.image_url ? [item.image_url] : [],
        },
        unit_amount: item.price_cents,
      },
      quantity: item.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${new URL(context.request.url).origin}/success`,
      cancel_url: `${new URL(context.request.url).origin}/merch`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('STRIPE ERROR:', err);

    return new Response(JSON.stringify({
      error: err.message || 'Stripe error'
    }), {
      status: 500,
    });
  }
};
