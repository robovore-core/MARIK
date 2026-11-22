# MARIK

MARIK is a reading-club web app with:

- React + Vite frontend
- Express API backend
- MongoDB persistence
- Google OAuth authentication

## Local Development

Install dependencies:

```bash
npm install
```

Create environment files:

- Root `.env.local` (frontend)

```env
VITE_API_BASE_URL=
```

- `server/.env` (backend)

```env
MONGODB_URI=your-mongodb-uri
MONGODB_DB=your-db-name
SESSION_SECRET=replace-with-a-strong-secret
FRONTEND_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5173/auth/google/callback
```

Run frontend and backend in separate terminals:

```bash
npm run dev
```

```bash
npm run api
```

## Production Build

Build frontend:

```bash
npm run build
```

Start backend:

```bash
node server/app.js
```

In production, the backend now serves the built frontend from `dist` and listens on `PORT`.

## Deploy On A Single Domain

Recommended setup is one web service hosting both API and frontend:

1. Build with `npm install && npm run build`.
2. Start with `node server/app.js`.
3. Set environment variables:
   - `NODE_ENV=production`
   - `PORT` (usually provided by host)
   - `MONGODB_URI`
   - `MONGODB_DB`
   - `SESSION_SECRET`
   - `FRONTEND_URL=https://your-domain.com`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL=https://your-domain.com/auth/google/callback`
4. In Google Cloud OAuth settings, add:
   - Authorized JavaScript origin: `https://your-domain.com`
   - Authorized redirect URI: `https://your-domain.com/auth/google/callback`

## Optional CORS Origins

If you need extra allowed origins (for preview domains), set:

```env
ADDITIONAL_CORS_ORIGINS=https://preview1.example.com,https://preview2.example.com
```
