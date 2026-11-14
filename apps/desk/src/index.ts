import { DESK_HOST, DESK_PORT, dataFile } from "./config.js";
import { ResearchDesk, openLog } from "./engine.js";
import { startServer } from "./server.js";

const log = openLog(dataFile());
const desk = new ResearchDesk(log);
startServer(desk, log);

console.log(`Research desk listening on http://${DESK_HOST}:${DESK_PORT}`);
console.log("Mode: research. Orders are not implemented in this process.");

desk.start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
});

function shutdown(): void {
  desk.stop();
  log.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
