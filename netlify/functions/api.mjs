const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const defaultStripePublishableKey = 'pk_test_51REXciCySCiHdPyyts0MmZgs87FbnLYUjF91PvwD4XWyL1SE1g7pkC5cxSKmOsNucOmLp6pB2yPSRhHFixA1p15Y00xqtwpkEL';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || defaultStripePublishableKey;
const cloudflareDownloadBaseUrl = (process.env.CLOUDFLARE_DOWNLOAD_BASE_URL || '').replace(/\/+$/, '');

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const stripeProducts = {
  door_knocking_script: {
    name: 'Door Knocking Script',
    amount: 1700,
    currency: 'usd',
    downloadFile: 'door-knocking-script.pdf'
  },
  roofing_leads: {
    name: 'How To Get Roofing Leads',
    amount: 2700,
    currency: 'usd',
    downloadFile: 'how-to-get-roofing-leads.pdf'
  }
};

const ariaInstructions = `
You are ARIA, a calm roofing specialist assistant with Black and White Roofing.
You are a relatable roofing business mentor, not a pushy salesperson.
Your job is to understand the visitor, make them feel heard, and guide qualified people toward the next step.

Style:
- Short, natural replies. Usually 1-3 sentences.
- Speak at a 3rd-5th grade reading level.
- Ask only one question at a time.
- Always react to what they just said before asking anything.
- Sound human, relaxed, and emotionally aware.
- Do not sound corporate, scripted, desperate, or hypey.

Discovery:
- Learn how long they have been in roofing.
- Learn if they are new or experienced.
- Learn their goals, struggles, income pressure, and why roofing caught their attention.
- If they show interest, softly guide them toward reserving the next training spot.

Rules:
- Never guarantee income or success.
- Never shame, pressure, argue, flirt, use profanity, or discuss politics/religion.
- If inappropriate, say: "I'd like to keep things respectful and focused on roofing."
- If trolling, say: "I'm here to help people serious about learning roofing and building something real."
`;

const respond = (statusCode, payload) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(payload)
});

const routePath = (event) => {
  const path = event.path || '';
  return path
    .replace(/^\/\.netlify\/functions\/api/, '')
    .replace(/^\/api/, '') || '/';
};

const readJson = (event) => {
  if (!event.body) return {};
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
};

const downloadUrl = (productId, fileName) => {
  const explicitUrl = process.env[`DOWNLOAD_URL_${productId.toUpperCase()}`];

  if (explicitUrl) return explicitUrl;
  if (!cloudflareDownloadBaseUrl) return '';

  return `${cloudflareDownloadBaseUrl}/${fileName}`;
};

const getProduct = (productId) => {
  const product = stripeProducts[String(productId || '')];

  if (!product) {
    const error = new Error('Unknown product');
    error.status = 400;
    throw error;
  }

  return product;
};

const publicProducts = () => Object.fromEntries(
  Object.entries(stripeProducts).map(([id, product]) => [id, {
    name: product.name,
    amount: product.amount,
    currency: product.currency
  }])
);

const productPayload = (productId, product, includeDownload = false) => ({
  name: product.name,
  amount: product.amount,
  currency: product.currency,
  downloadUrl: includeDownload ? downloadUrl(productId, product.downloadFile) : ''
});

const stripeRequest = async (path, params = {}, method = 'POST') => {
  if (!stripeSecretKey) {
    const error = new Error('STRIPE_SECRET_KEY is not set');
    error.status = 503;
    throw error;
  }

  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const request = {
    method,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`
    }
  };

  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  } else {
    request.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    request.body = new URLSearchParams(params);
  }

  const response = await fetch(url, request);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error?.message || 'Stripe request failed');
    error.status = response.status;
    error.stripeCode = data.error?.code;
    throw error;
  }

  return data;
};

const handleAriaChat = async (event) => {
  if (!process.env.OPENAI_API_KEY) {
    return respond(503, { error: 'OPENAI_API_KEY is not set' });
  }

  try {
    const body = readJson(event);
    const lead = body.leadProfile || {};
    const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-12) : [];
    const message = String(body.message || '').trim();

    const context = [
      `Lead name: ${lead.name || 'unknown'}`,
      `First name: ${lead.firstName || 'unknown'}`,
      `Email: ${lead.email || 'unknown'}`,
      `Phone: ${lead.phone || 'unknown'}`,
      `Known roofing status: ${lead.roofingStatus || 'unknown'}`,
      `Known goal: ${lead.goal || 'unknown'}`,
      `Known obstacle: ${lead.obstacle || 'unknown'}`
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions: `${ariaInstructions}\n\nLead context:\n${context}`,
        input: [
          ...transcript.map((item) => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: String(item.content || '')
          })),
          { role: 'user', content: message }
        ],
        max_output_tokens: 160
      })
    });

    if (!response.ok) return respond(502, { error: 'AI provider error' });

    const data = await response.json();
    const reply = data.output_text || data.output?.[0]?.content?.[0]?.text || '';
    return respond(200, { reply });
  } catch {
    return respond(500, { error: 'Unable to generate reply' });
  }
};

const handleStripeConfig = async () => respond(200, {
  publishableKey: stripePublishableKey,
  products: publicProducts()
});

const handleCreatePaymentIntent = async (event) => {
  try {
    const body = readJson(event);
    const productId = String(body.productId || '');
    const product = getProduct(productId);
    const lead = body.lead || {};
    const customerId = String(body.customerId || '').trim();
    const customer = customerId || (await stripeRequest('customers', {
      name: String(lead.name || '').slice(0, 160),
      email: String(lead.email || '').slice(0, 240),
      phone: String(lead.phone || '').slice(0, 40),
      'metadata[source]': 'livestream_replay'
    })).id;

    const paymentIntent = await stripeRequest('payment_intents', {
      amount: String(product.amount),
      currency: product.currency,
      customer,
      description: product.name,
      setup_future_usage: 'off_session',
      'automatic_payment_methods[enabled]': 'true',
      'metadata[product_id]': productId,
      'metadata[product_name]': product.name
    });

    return respond(200, {
      clientSecret: paymentIntent.client_secret,
      customerId: customer,
      product: productPayload(productId, product)
    });
  } catch (error) {
    return respond(error.status || 500, { error: error.message || 'Unable to start payment' });
  }
};

const handleChargeSavedPaymentMethod = async (event) => {
  try {
    const body = readJson(event);
    const productId = String(body.productId || '');
    const product = getProduct(productId);
    const customerId = String(body.customerId || '').trim();
    const paymentMethodId = String(body.paymentMethodId || '').trim();

    if (!customerId || !paymentMethodId) return respond(400, { error: 'Saved payment details are missing' });

    const paymentIntent = await stripeRequest('payment_intents', {
      amount: String(product.amount),
      currency: product.currency,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: 'true',
      off_session: 'true',
      error_on_requires_action: 'true',
      description: product.name,
      'metadata[product_id]': productId,
      'metadata[product_name]': product.name
    });

    return respond(200, {
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      product: productPayload(productId, product, paymentIntent.status === 'succeeded')
    });
  } catch (error) {
    return respond(error.status || 500, {
      error: error.message || 'Unable to charge saved card',
      code: error.stripeCode || ''
    });
  }
};

const handleConfirmPurchase = async (event) => {
  try {
    const body = readJson(event);
    const productId = String(body.productId || '');
    const product = getProduct(productId);
    const paymentIntentId = String(body.paymentIntentId || '').trim();

    if (!paymentIntentId) return respond(400, { error: 'Payment confirmation is missing' });

    const paymentIntent = await stripeRequest(`payment_intents/${paymentIntentId}`, {}, 'GET');
    const paidProductId = paymentIntent.metadata?.product_id || productId;

    if (paymentIntent.status !== 'succeeded' || paidProductId !== productId) {
      return respond(402, { error: 'Payment has not been confirmed yet' });
    }

    return respond(200, {
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      product: productPayload(productId, product, true)
    });
  } catch (error) {
    return respond(error.status || 500, { error: error.message || 'Unable to confirm purchase' });
  }
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: jsonHeaders, body: '' };

  const path = routePath(event);

  if (event.httpMethod === 'POST' && path === '/aria-chat') return handleAriaChat(event);
  if (event.httpMethod === 'GET' && path === '/stripe/config') return handleStripeConfig();
  if (event.httpMethod === 'POST' && path === '/stripe/create-payment-intent') return handleCreatePaymentIntent(event);
  if (event.httpMethod === 'POST' && path === '/stripe/charge-saved') return handleChargeSavedPaymentMethod(event);
  if (event.httpMethod === 'POST' && path === '/stripe/confirm-purchase') return handleConfirmPurchase(event);

  return respond(404, { error: 'Not found' });
};
