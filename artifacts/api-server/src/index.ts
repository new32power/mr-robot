import http from "node:http";
import app from "./app";
import { ensureSchema } from "./lib/db";
import { setupWebSocket } from "./lib/ws";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
setupWebSocket(server);

ensureSchema()
  .then(() => {
    server.listen(port, () => {
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Schema initialization failed");
    process.exit(1);
  });
