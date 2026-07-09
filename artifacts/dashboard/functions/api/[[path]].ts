// CF Pages Function — proxies /api/* to the backend worker
  // BACKEND_URL env var is set as CF Pages secret — backend URL NEVER exposed to browser/DevTools
  // Runs on Cloudflare edge (server-side) — browser only sees mr-robot-f39.pages.dev

  export async function onRequest(context) {
    try {
      const { request, env, params } = context;
      // Backend URL hidden from browser — this file runs server-side only on CF edge
      const backend = (env.BACKEND_URL || "https://mr-robot-api.newpwor898.workers.dev").replace(/\/$/, "");

      const url = new URL(request.url);
      const path = [].concat(params.path || []).join("/");
      const target = backend + "/api/" + path + url.search;

      const headers = new Headers(request.headers);
      headers.delete("host");

      // ── WebSocket upgrade ──────────────────────────────────────────────────────
      // Must return the backend response DIRECTLY (no new Response() wrapping).
      // Wrapping strips the 101 Switching Protocols handshake → browser gets 502.
      // CF Workers natively forwards WebSocket connections via fetch().
      // Backend URL still never appears in DevTools — browser only sees pages.dev.
      if (request.headers.get("Upgrade") === "websocket") {
        return fetch(target, { method: "GET", headers });
      }

      // ── Regular HTTP ──────────────────────────────────────────────────────────
      const hasBody = !["GET", "HEAD"].includes(request.method);
      const body = hasBody ? await request.arrayBuffer() : null;

      const resp = await fetch(target, {
        method: request.method,
        headers,
        body,
      });

      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch (err) {
      return Response.json({ proxy_error: String(err) }, { status: 502 });
    }
  }
  