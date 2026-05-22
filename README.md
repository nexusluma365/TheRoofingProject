# Ghines VSL Funnel

Static VSL funnel with a Netlify Functions backend for ARIA chat, Stripe payments, and post-purchase Cloudflare downloads.

## Pages

- `01_landing_page.html` - landing page
- `02_livestream_replay.html` - livestream replay, offer checkout, Stripe payment flow
- `03_roofing_blueprint.html` - local blueprint page backup

## Netlify Setup

Build settings:

- Build command: leave blank or use `npm run check`
- Publish directory: `.`
- Functions directory: `netlify/functions`

Environment variables:

```text
OPENAI_API_KEY
OPENAI_MODEL
STRIPE_SECRET_KEY
CLOUDFLARE_DOWNLOAD_BASE_URL
```

The livestream currently includes the Stripe test publishable key in its server-side config response. Set `STRIPE_SECRET_KEY` in Netlify with the matching Stripe test secret key before testing payments. Add `STRIPE_PUBLISHABLE_KEY` later if you need to override the bundled client key, such as when switching to live Stripe keys.

You can also set per-product Cloudflare URLs:

```text
DOWNLOAD_URL_DOOR_KNOCKING_SCRIPT
DOWNLOAD_URL_ROOFING_LEADS
```

If using `CLOUDFLARE_DOWNLOAD_BASE_URL`, upload files with these names:

```text
door-knocking-script.pdf
how-to-get-roofing-leads.pdf
```

## Cloudflare Downloads

The livestream backend returns a download link only after Stripe confirms a paid product. The files themselves must already exist at Cloudflare URLs that Netlify can build from the environment variables below.

### Recommended Setup: Cloudflare R2

1. Sign in to Cloudflare and open **R2 Object Storage**.
2. Create a bucket for the paid files, for example `roofing-downloads`.
3. Upload the two product files to that bucket with these exact object names:

```text
door-knocking-script.pdf
how-to-get-roofing-leads.pdf
```

4. Make the files reachable through a public download domain.
   - For production, connect a custom domain to the R2 bucket, for example `downloads.yourdomain.com`.
   - For a quick test, Cloudflare can expose an R2 `r2.dev` public development URL. Use the custom domain path for production.
5. Open each public file URL in a private browser window and confirm the PDF downloads or renders. The base URL must be the part before the file name.

Example URLs:

```text
https://downloads.yourdomain.com/door-knocking-script.pdf
https://downloads.yourdomain.com/how-to-get-roofing-leads.pdf
```

The matching base URL is:

```text
https://downloads.yourdomain.com
```

6. In Netlify, open the site settings and add this environment variable:

```text
CLOUDFLARE_DOWNLOAD_BASE_URL=https://downloads.yourdomain.com
```

7. Redeploy the Netlify site after saving the environment variable.
8. Test a Stripe payment in the livestream:
   - Buy **Door Knocking Script** and confirm its download button opens `door-knocking-script.pdf`.
   - Buy **How To Get Roofing Leads** and confirm its download button opens `how-to-get-roofing-leads.pdf`.

### Per-Product URL Setup

Use per-product URLs when the two files do not share one Cloudflare base URL.

1. Upload both files to Cloudflare.
2. Copy the full public URL for each file.
3. In Netlify, set these environment variables:

```text
DOWNLOAD_URL_DOOR_KNOCKING_SCRIPT=https://your-download-url/door-knocking-script.pdf
DOWNLOAD_URL_ROOFING_LEADS=https://your-download-url/how-to-get-roofing-leads.pdf
```

4. Redeploy the Netlify site.
5. Run a Stripe test purchase for each product and confirm the download button opens the correct file.

### Important

- Do not upload renamed files if you use `CLOUDFLARE_DOWNLOAD_BASE_URL`. The backend expects the exact file names listed above.
- Do not commit Cloudflare URLs, Stripe keys, or `.env` files when those values should stay environment-specific.
- Direct public Cloudflare file URLs can be shared after a buyer receives them. If downloads need access control, replace public URLs with a signed or authenticated download flow before launch.

## Local Development

Install dependencies:

```bash
npm install
```

Run with Netlify Functions:

```bash
npm run dev
```

Run the simple local Node server:

```bash
npm run serve
```

Check syntax:

```bash
npm run check
```

## GitHub

This folder is ready to initialize as a Git repository:

```bash
git init
git add .
git commit -m "Prepare funnel for Netlify deployment"
```

Do not commit `.env` files. Use Netlify environment variables instead.
