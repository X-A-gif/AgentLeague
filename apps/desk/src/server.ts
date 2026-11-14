import http from "node:http";
import { DESK_HOST, DESK_PORT, WEB_ORIGIN } from "./config.js";
import type { DecisionLog } from "./log.js";
import type { ResearchDesk } from "./engine.js";

export function startServer(desk: ResearchDesk, log: DecisionLog): http.Server {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${DESK_HOST}:${DESK_PORT}`);
    response.setHeader("Access-Control-Allow-Origin", WEB_ORIGIN);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/kill") {
      send(response, 200, { ok: true, mode: "halted", actions: desk.kill() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/resume") {
      desk.resume();
      send(response, 200, { ok: true, mode: "research" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/paper") {
      const result = desk.enablePaper();
      send(response, result.ok ? 200 : 409, result);
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "This desk does not accept order requests." }));
      return;
    }
    if (url.pathname === "/health") {
      send(response, 200, { ok: true, mode: desk.snapshot().mode, ordersEnabled: false });
      return;
    }
    if (url.pathname === "/snapshot") {
      send(response, 200, desk.snapshot());
      return;
    }
    if (url.pathname === "/events") {
      const limit = Number(url.searchParams.get("limit") ?? "80");
      send(response, 200, { events: log.list(Number.isFinite(limit) ? Math.min(limit, 200) : 80) });
      return;
    }
    send(response, 404, { error: "Not found" });
  });
  server.listen(DESK_PORT, DESK_HOST);
  return server;
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
