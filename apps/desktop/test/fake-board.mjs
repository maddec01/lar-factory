// Stands in for apps/server/src/server.ts. FAKE_BOARD sets what it does:
// - "ready": reports its port; /healthz answers 503 to the first FAKE_BOARD_BUSY
//   requests, then 200. /hits returns how many /healthz requests it has had.
// - "silent": listens but never reports a port.
// - "crash": exits with code 3 before it reports a port.
// With FAKE_BOARD_CHECK=1 it asks its parent for a skill check once it reports its port, with FAKE_BOARD_DRIFT as its
// Drift choice when set, and /answer returns the parent's answer, or null until it comes.
// It exits with code 2 unless it runs with ELECTRON_RUN_AS_NODE=1.
import { createServer } from "node:http";

if (process.env.ELECTRON_RUN_AS_NODE !== "1") process.exit(2);
const mode = process.env.FAKE_BOARD ?? "ready";
if (mode === "crash") process.exit(3);

const busy = Number(process.env.FAKE_BOARD_BUSY ?? "0");
let hits = 0;
let answer = null;
process.on("message", (message) => {
  if (message?.type === "skills-checked") answer = message;
});
const server = createServer((req, res) => {
  if (req.url === "/healthz") {
    hits += 1;
    res.writeHead(hits > busy ? 200 : 503).end();
  } else if (req.url === "/answer") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
  } else if (req.url === "/hits") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(hits));
  } else {
    res.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1", () => {
  if (mode !== "ready") return;
  process.send({ type: "listening", port: server.address().port });
  const drift = process.env.FAKE_BOARD_DRIFT;
  if (process.env.FAKE_BOARD_CHECK === "1") process.send({ type: "check-skills", id: 7, ...drift && { drift } });
});
