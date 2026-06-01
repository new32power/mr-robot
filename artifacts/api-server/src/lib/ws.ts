import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const clients = new Set<WebSocket>();

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? "";
    if (url === "/api/events" || url.startsWith("/api/events?")) {
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        clients.add(ws);
        ws.on("close", () => clients.delete(ws));
        ws.on("error", () => clients.delete(ws));
      });
    } else {
      socket.destroy();
    }
  });
}

export function broadcast(event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(msg); } catch { /* ignore */ }
    }
  }
}
