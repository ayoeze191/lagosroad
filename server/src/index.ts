import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./RaceRoom.js";

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: false,
  express: (app) => {
    app.get("/health", (_, res) => res.json({ ok: true, service: "lagos-road-racer" }));
  }
});
gameServer.define("race", RaceRoom);

const port = Number(process.env.PORT || 2567);
await gameServer.listen(port);
console.log(`Race server listening on ws://localhost:${port}`);
