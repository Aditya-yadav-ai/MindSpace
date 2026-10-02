# MindSpace

MindSpace is a browser-focused AI workspace for summarising pages, extracting key facts, and working with context captured from the active tab. It is designed to feel like a calm research side panel for reading, writing, and understanding online content.

## Features

- Browser workspace UI for reading and summarising page content
- Prompt-based AI chat with page context and selected passage support
- Saved history and knowledge base flows
- Task and automation panels
- Google OAuth-ready integration for account-based services
- Chrome extension-style side panel scaffolding
- Screenshot capture flow for page context collection

## Tech stack

- React + TypeScript
- TanStack Start / Vite
- Supabase Auth + Postgres
- Lovable Cloud AI integration
- Tailwind CSS
- Chrome extension manifest scaffold

## Project structure

```text
src/
  components/
  integrations/
  lib/
  routes/
public/
  manifest.json
  extension-background.js
supabase/
  migrations/
```

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env.local
```

3. Add your real values in `.env.local`.

4. Start the app:

```bash
npm run dev -- --host 0.0.0.0
```

5. Open:

```text
http://localhost:8080/
```

## Environment variables

Copy the sample file before running locally:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_publishable_key
LOVABLE_API_KEY=your_lovable_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/google/oauth-callback
```

Important:

- Do not commit `.env.local` or any real secrets
- Keep all credentials in your local environment or secret manager

## Supabase setup

1. Create a Supabase project
2. Enable Google provider in Authentication → Providers
3. Add your Google OAuth client ID and secret
4. Configure redirect URLs for local development and production

Recommended local redirect values:

```text
http://localhost:8080
https://your-domain.com
```

And for Supabase callback:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

## Google OAuth setup

1. Create a Google Cloud OAuth client
2. Add authorized JavaScript origins:
   - `http://localhost:8080`
3. Add authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback`

## Chrome extension usage

This project includes Chrome extension scaffolding in `public/manifest.json` and `public/extension-background.js`.

To load it in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Choose Load unpacked
4. Select the project folder containing the manifest

## Build

```bash
npm run build
```

## Security notes

- Never commit real API keys or secrets
- Use `.env.local` only for local development
- Keep production credentials in a secure hosting environment
- Prefer environment variables over hard-coded values

## License

This project is currently configured for local / personal development use unless otherwise specified by the project owner.
