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
STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY
CLOUDFLARE_DOWNLOAD_BASE_URL
```

You can also set per-product Cloudflare URLs:

```text
DOWNLOAD_URL_FULL_ACCESS
DOWNLOAD_URL_DOOR_PITCH
DOWNLOAD_URL_STARTUP_MAP
DOWNLOAD_URL_LEADS_WITHOUT_LISTS
DOWNLOAD_URL_KNOCKING_KIT
DOWNLOAD_URL_TRACKER_PACK
DOWNLOAD_URL_OBJECTION_ANSWERS
DOWNLOAD_URL_ACTION_SPRINT
DOWNLOAD_URL_CLOSE_KIT
```

If using `CLOUDFLARE_DOWNLOAD_BASE_URL`, upload files with these names:

```text
roofing-pro-full-access.zip
door-pitch-script-kit.pdf
30-day-roofing-startup-map.pdf
roofing-leads-without-lists.pdf
door-knocking-20-house-kit.pdf
estimate-job-tracker-pack.zip
objection-answer-kit.pdf
first-7-days-action-sprint.pdf
beginner-roofing-close-kit.pdf
```

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
