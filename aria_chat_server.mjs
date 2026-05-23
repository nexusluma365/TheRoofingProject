import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const defaultStripePublishableKey = 'pk_test_51REXciCySCiHdPyyts0MmZgs87FbnLYUjF91PvwD4XWyL1SE1g7pkC5cxSKmOsNucOmLp6pB2yPSRhHFixA1p15Y00xqtwpkEL';
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || defaultStripePublishableKey;
const cloudflareDownloadBaseUrl = (process.env.CLOUDFLARE_DOWNLOAD_BASE_URL || '').replace(/\/+$/, '');
const googleSheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || '';

const downloadUrl = (productId, product) => {
  const envName = `DOWNLOAD_URL_${productId.toUpperCase()}`;
  const explicitUrl = process.env[envName];
  const fileName = process.env[product.downloadEnvKey] || product.downloadFile;
  const encodedFileName = fileName.split('/').map(encodeURIComponent).join('/');

  if (explicitUrl) return explicitUrl;
  if (!cloudflareDownloadBaseUrl) return '';

  return `${cloudflareDownloadBaseUrl}/${encodedFileName}`;
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

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
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

const readRequestBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
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

const handleSheetsCapture = async (req, res) => {
  const body = JSON.parse(await readRequestBody(req));
  const eventType = String(body.eventType || 'lead').trim();

  if (!['lead', 'purchase'].includes(eventType)) {
    sendJson(res, 400, { error: 'Unknown capture event type' });
    return;
  }

  const result = await captureSheetEvent({
    eventType,
    lead: body.lead || {},
    purchase: body.purchase || {},
    source: body.source || 'site'
  });

  sendJson(res, 200, result);
};

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
      'Authorization': `Bearer ${stripeSecretKey}`
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

const productPayload = (productId, product, includeDownload = false) => ({
  name: product.name,
  amount: product.amount,
  currency: product.currency,
  downloadUrl: includeDownload ? downloadUrl(productId, product) : ''
});

const publicProducts = () => Object.fromEntries(
  Object.entries(stripeProducts).map(([id, product]) => [id, {
    name: product.name,
    amount: product.amount,
    currency: product.currency
  }])
);

const getProduct = (productId) => {
  const product = stripeProducts[String(productId || '')];

  if (!product) {
    const error = new Error('Unknown product');
    error.status = 400;
    throw error;
  }

  return product;
};

const handleStripeConfig = async (req, res) => {
  sendJson(res, 200, {
    publishableKey: stripePublishableKey,
    products: publicProducts()
  });
};

const handleCreatePaymentIntent = async (req, res) => {
  try {
    const body = JSON.parse(await readRequestBody(req));
    const product = getProduct(body.productId);
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
      'payment_method_types[]': 'card',
      'metadata[product_id]': String(body.productId || ''),
      'metadata[product_name]': product.name
    });

    sendJson(res, 200, {
      clientSecret: paymentIntent.client_secret,
      customerId: customer,
      product: productPayload(String(body.productId || ''), product)
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || 'Unable to start payment'
    });
  }
};

const handleChargeSavedPaymentMethod = async (req, res) => {
  try {
    const body = JSON.parse(await readRequestBody(req));
    const product = getProduct(body.productId);
    const productId = String(body.productId || '');
    const lead = body.lead || {};
    const customerId = String(body.customerId || '').trim();
    const paymentMethodId = String(body.paymentMethodId || '').trim();

    if (!customerId || !paymentMethodId) {
      sendJson(res, 400, { error: 'Saved payment details are missing' });
      return;
    }

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

    sendJson(res, 200, {
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      product: productPayload(productId, product, paymentIntent.status === 'succeeded')
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || 'Unable to charge saved card',
      code: error.stripeCode || ''
    });
  }
};

const handleConfirmPurchase = async (req, res) => {
  try {
    const body = JSON.parse(await readRequestBody(req));
    const productId = String(body.productId || '');
    const product = getProduct(productId);
    const lead = body.lead || {};
    const paymentIntentId = String(body.paymentIntentId || '').trim();

    if (!paymentIntentId) {
      sendJson(res, 400, { error: 'Payment confirmation is missing' });
      return;
    }

    const paymentIntent = await stripeRequest(`payment_intents/${paymentIntentId}`, {}, 'GET');
    const paidProductId = paymentIntent.metadata?.product_id || productId;

    if (paymentIntent.status !== 'succeeded' || paidProductId !== productId) {
      sendJson(res, 402, { error: 'Payment has not been confirmed yet' });
      return;
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

    sendJson(res, 200, {
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      product: productPayload(productId, product, true)
    });
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || 'Unable to confirm purchase'
    });
  }
};

const handleAriaChat = async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 503, { error: 'OPENAI_API_KEY is not set' });
    return;
  }

  try {
    const body = JSON.parse(await readRequestBody(req));
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
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions: `${ariaInstructions}\n\nLead context:\n${context}`,
        input: [{ role: 'user', content: message }],
        max_output_tokens: 50
      })
    });

    if (!response.ok) {
      sendJson(res, 502, { error: 'AI provider error' });
      return;
    }

    const data = await response.json();
    const reply = data.output_text || data.output?.[0]?.content?.[0]?.text || '';
    sendJson(res, 200, { reply: shortReply(reply) });
  } catch {
    sendJson(res, 500, { error: 'Unable to generate reply' });
  }
};

const serveStatic = async (req, res) => {
  const rawPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const cleanPath = rawPath === '/' ? '/01_landing_page.html' : rawPath;
  const safePath = normalize(cleanPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const fileSize = statSync(filePath).size;
  const range = req.headers.range;

  if ((ext === '.mp4' || ext === '.mov') && range) {
    const [rangeStart, rangeEnd] = range.replace(/bytes=/, '').split('-');
    const start = Number.parseInt(rangeStart, 10);
    const end = rangeEnd ? Number.parseInt(rangeEnd, 10) : fileSize - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Accept-Ranges': ext === '.mp4' || ext === '.mov' ? 'bytes' : 'none',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    'Content-Length': fileSize,
    'Content-Type': contentType
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
};

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/aria-chat') {
    await handleAriaChat(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/sheets/capture') {
    await handleSheetsCapture(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/stripe/config') {
    await handleStripeConfig(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/stripe/create-payment-intent') {
    await handleCreatePaymentIntent(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/stripe/charge-saved') {
    await handleChargeSavedPaymentMethod(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/stripe/confirm-purchase') {
    await handleConfirmPurchase(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/get-download-link') {
    await handleConfirmPurchase(req, res);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method not allowed');
}).listen(port, () => {
  console.log(`ARIA smart chat server running at http://127.0.0.1:${port}`);
});
