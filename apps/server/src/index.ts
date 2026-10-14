import { createApp } from './app.ts';

/**
 * Entry point.
 *
 * Configuration is environment variables and nothing else, so the same build
 * runs locally and wherever it is deployed.
 */
const app = createApp({
  dataDir: process.env.DATA_DIR ?? './data',
  port: Number(process.env.PORT ?? 8787),
  ...(process.env.ALLOWED_ORIGINS
    ? { allowedOrigins: process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()) }
    : {}),
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port);
console.log(`mon server on :${port}, data in ${process.env.DATA_DIR ?? './data'}`);
