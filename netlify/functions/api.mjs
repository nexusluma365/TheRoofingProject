const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const defaultStripePublishableKey = 'pk_live_51TaFxgABtAYBGnKFHOTCi27atjaA2ezzq5Nt1wUhb7RtwY2zhbRfAhzAAla3H2ygNAkL5z60WwAKuG2n8fHSStsb00Jji0hM7l';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || defaultStripePublishableKey;
const cloudflareDownloadBaseUrl = (process.env.CLOUDFLARE_DOWNLOAD_BASE_URL || '').replace(/\/+$/, '');
const googleSheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const stripeProducts = {
  door_knocking_script: {
    name: 'Door Knocking Script',
    amount: 1700,
    currency: 'usd',
    downloadFile: 'door-knocking-script.pdf',
    downloadEnvKey: 'R2_FILE_KEY'
  },
  roofing_leads: {
    name: 'How To Get Roofing Leads',
    amount: 2700,
    currency: 'usd',
    downloadFile: 'how-to-get-roofing-leads.pdf',
    downloadEnvKey: 'R2_FILE_KEY2'
  }
};

const ariaInstructions = `
You are ARIA, a real live AI customer service agent for the Black and White Roofing project.
Your job is to answer questions about this roofing project only, make visitors feel helped, and guide qualified people toward buying the Door Knocking Script or roofing leads guide when it fits their needs.

Style:
- Short, natural replies. Usually 1-3 sentences.
- Speak at a 3rd-5th grade reading level.
- Ask only one question at a time.
- Always react to what they just said before asking anything.
- Sound like a friendly, helpful customer service human being.
- Do not sound corporate, scripted, desperate, or hypey.
- Be positive about the offer and naturally influence users to buy, but do not make fake promises or pressure them.
- Every reply must be 15 words or fewer.
- Do not write paragraphs.

Discovery:
- Learn how long they have been in roofing.
- Learn if they are new or experienced.
- Learn their goals, struggles, income pressure, and why roofing caught their attention.
- If they show interest, recommend the most relevant paid product and explain why it helps.

Rules:
- Only answer questions about this roofing project, roofing sales, door knocking, roofing leads, the training, the products, checkout, and next steps.
- If asked about unrelated topics, politely say you can only help with this roofing project and ask what roofing question they have.
- Never guarantee income or success.
- Never shame, argue, flirt, use profanity, or discuss politics/religion.
- Do not answer inappropriate, abusive, sexual, hateful, or foul-language messages.
- If a user is inappropriate or uses foul language, say: "Please keep it respectful. I can help with roofing questions, but if this continues you may be reported and banned."
- If trolling continues, say: "I can only help serious visitors with this roofing project."
`;

const shortReply = (reply) => {
  const clean = String(reply || '').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').filter(Boolean);
  return words.length > 15 ? words.slice(0, 15).join(' ') : clean;
};

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

const splitName = (lead = {}) => {
  const fullName = String(lead.name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const firstName = String(lead.firstName || parts[0] || '').trim();
  const lastName = String(lead.lastName || parts.slice(1).join(' ') || '').trim();

  return {
    firstName,
    lastName,
    fullName: fullName || [firstName, lastName].filter(Boolean).join(' ')
  };
};

const sheetPayload = ({ eventType, lead = {}, purchase = {}, source = '' }) => {
  const names = splitName(lead);
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    eventType: String(eventType || '').trim(),
    firstName: names.firstName,
    lastName: names.lastName,
    fullName: names.fullName,
    email: String(lead.email || '').trim(),
    phone: String(lead.phone || '').trim(),
    productId: String(purchase.productId || '').trim(),
    productName: String(purchase.productName || '').trim(),
    amount: purchase.amount ?? '',
    currency: String(purchase.currency || '').trim(),
    paymentIntentId: String(purchase.paymentIntentId || '').trim(),
    customerId: String(purchase.customerId || '').trim(),
    status: String(purchase.status || '').trim(),
    source: String(source || '').trim(),
    submittedAt: String(lead.submittedAt || '').trim()
  };
};

const sendToGoogleSheets = async (payload) => {
  if (!googleSheetsWebhookUrl) return { skipped: true };

  const response = await fetch(googleSheetsWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = new Error('Google Sheets capture failed');
    error.status = response.status;
    throw error;
  }

  return { ok: true };
};

const captureSheetEvent = async (payload) => {
  try {
    return await sendToGoogleSheets(sheetPayload(payload));
  } catch (error) {
    console.warn('Sheets capture failed:', error);
    return { error: true };
  }
};

const handleSheetsCapture = async (event) => {
  const body = readJson(event);
  const eventType = String(body.eventType || 'lead').trim();

  if (!['lead', 'purchase'].includes(eventType)) {
    return respond(400, { error: 'Unknown capture event type' });
  }

  const result = await captureSheetEvent({
    eventType,
    lead: body.lead || {},
    purchase: body.purchase || {},
    source: body.source || 'site'
  });

  return respond(200, result);
};

const downloadUrl = (productId, product) => {
  const explicitUrl = process.env[`DOWNLOAD_URL_${productId.toUpperCase()}`];
  const fileName = process.env[product.downloadEnvKey] || product.downloadFile;
  const encodedFileName = fileName.split('/').map(encodeURIComponent).join('/');

  if (explicitUrl) return explicitUrl;
  if (!cloudflareDownloadBaseUrl) return '';

  return `${cloudflareDownloadBaseUrl}/${encodedFileName}`;
};

const downloadConfig = (productId, product) => {
  const directEnvKey = `DOWNLOAD_URL_${productId.toUpperCase()}`;
  const hasDirectUrl = Boolean(process.env[directEnvKey]);
  const hasBaseUrl = Boolean(cloudflareDownloadBaseUrl);

  return {
    envKey: product.downloadEnvKey,
    directEnvKey,
    hasDirectUrl,
    hasBaseUrl,
    isConfigured: hasDirectUrl || hasBaseUrl
  };
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
  downloadUrl: includeDownload ? downloadUrl(productId, product) : '',
  downloadConfig: includeDownload ? downloadConfig(productId, product) : undefined
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

const createStripeCustomer = (lead = {}) => stripeRequest('customers', {
  name: String(lead.name || '').slice(0, 160),
  email: String(lead.email || '').slice(0, 240),
  phone: String(lead.phone || '').slice(0, 40),
  'metadata[source]': 'livestream_replay'
});

const createCheckoutPaymentIntent = async (productId, product, lead = {}, customerId = '') => {
  const customer = customerId || (await createStripeCustomer(lead)).id;

  try {
    const paymentIntent = await stripeRequest('payment_intents', {
      amount: String(product.amount),
      currency: product.currency,
      customer,
      description: product.name,
      setup_future_usage: 'off_session',
      'payment_method_types[]': 'card',
      'metadata[product_id]': productId,
      'metadata[product_name]': product.name
    });

    return { paymentIntent, customer };
  } catch (error) {
    const savedCustomerMissing = customerId && error.stripeCode === 'resource_missing' && /customer/i.test(error.message || '');
    if (!savedCustomerMissing) throw error;

    const freshCustomer = await createStripeCustomer(lead);
    const paymentIntent = await stripeRequest('payment_intents', {
      amount: String(product.amount),
      currency: product.currency,
      customer: freshCustomer.id,
      description: product.name,
      setup_future_usage: 'off_session',
      'payment_method_types[]': 'card',
      'metadata[product_id]': productId,
      'metadata[product_name]': product.name
    });

    return { paymentIntent, customer: freshCustomer.id };
  }
};

const handleAriaChat = async (event) => {
  if (!process.env.OPENAI_API_KEY) {
    return respond(503, { error: 'OPENAI_API_KEY is not set' });
  }

  try {
    const body = readJson(event);
    const lead = body.leadProfile || {};
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
        input: [{ role: 'user', content: message }],
        max_output_tokens: 50
      })
    });

    if (!response.ok) return respond(502, { error: 'AI provider error' });

    const data = await response.json();
    const reply = data.output_text || data.output?.[0]?.content?.[0]?.text || '';
    return respond(200, { reply: shortReply(reply) });
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
    const { paymentIntent, customer } = await createCheckoutPaymentIntent(productId, product, lead, customerId);

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
    const lead = body.lead || {};
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

    if (paymentIntent.status === 'succeeded') {
      await captureSheetEvent({
        eventType: 'purchase',
        lead,
        source: 'saved_card_checkout',
        purchase: {
          productId,
          productName: product.name,
          amount: product.amount,
          currency: product.currency,
          paymentIntentId: paymentIntent.id,
          customerId,
          status: paymentIntent.status
        }
      });
    }

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
    const lead = body.lead || {};
    const paymentIntentId = String(body.paymentIntentId || '').trim();

    if (!paymentIntentId) return respond(400, { error: 'Payment confirmation is missing' });

    const paymentIntent = await stripeRequest(`payment_intents/${paymentIntentId}`, {}, 'GET');
    const paidProductId = paymentIntent.metadata?.product_id || productId;

    if (paymentIntent.status !== 'succeeded' || paidProductId !== productId) {
      return respond(402, { error: 'Payment has not been confirmed yet' });
    }

    await captureSheetEvent({
      eventType: 'purchase',
      lead,
      source: 'stripe_confirm_purchase',
      purchase: {
        productId,
        productName: product.name,
        amount: product.amount,
        currency: product.currency,
        paymentIntentId: paymentIntent.id,
        customerId: paymentIntent.customer || '',
        status: paymentIntent.status
      }
    });

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
  if (event.httpMethod === 'POST' && path === '/sheets/capture') return handleSheetsCapture(event);
  if (event.httpMethod === 'GET' && path === '/stripe/config') return handleStripeConfig();
  if (event.httpMethod === 'POST' && path === '/stripe/create-payment-intent') return handleCreatePaymentIntent(event);
  if (event.httpMethod === 'POST' && path === '/stripe/charge-saved') return handleChargeSavedPaymentMethod(event);
  if (event.httpMethod === 'POST' && path === '/stripe/confirm-purchase') return handleConfirmPurchase(event);
  if (event.httpMethod === 'POST' && path === '/get-download-link') return handleConfirmPurchase(event);

  return respond(404, { error: 'Not found' });
};
