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
console.log('  Connect (protobuf or JSON), gRPC-Web, and the JSON routes');

/**
 * gRPC, only if asked for.
 *
 * It needs its own port: gRPC carries its status in trailers, trailers need
 * HTTP/2, and node cannot serve cleartext HTTP/2 and HTTP/1.1 on one socket. Off
 * by default because nothing in this product speaks gRPC — the phones get binary
 * protobuf over the Connect protocol, which needs no second listener. Set
 * GRPC_PORT when a Go service, a mesh or `grpcurl` is on the other end.
 */
if (process.env.GRPC_PORT) {
  const grpcPort = Number(process.env.GRPC_PORT);
  app.listenGrpc(grpcPort);
  console.log(`  gRPC over cleartext HTTP/2 on :${grpcPort}`);
}
