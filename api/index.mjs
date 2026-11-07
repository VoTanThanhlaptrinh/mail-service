// Vercel serverless entry: wraps the compiled Express app (built by `npm run build`).
// Static client assets are served by Vercel's CDN from client/dist; /api/* is rewritten here.
import { createApp } from '../server/dist/app.js';

export default createApp();
