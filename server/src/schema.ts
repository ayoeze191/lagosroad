import { MapSchema, Schema, type } from "@colyseus/schema";

export class Racer extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "Racer";
  @type("string") carId = "runner";
  @type("string") colour = "#1f7ae0";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") heading = 0;
  @type("float32") speed = 0;
  /** Smoothed steering and last pothole id, so the client can replay inputs exactly. */
  @type("float32") steer = 0;
  @type("string") hole = "";
  /** Last input sequence number the server has simulated (for client-side prediction). */
  @type("uint32") ack = 0;
  /** Metres left to the finish along the road network. */
  @type("float32") remaining = 0;
  @type("uint8") place = 0;
  @type("boolean") ready = false;
  @type("boolean") finished = false;
  @type("boolean") connected = true;
  /** Seconds from the start signal. */
  @type("float32") finishTime = 0;
  /** Street law: heat 0–100; seconds held and by whom ("police"/"agbero"); the chasers, if any. */
  @type("uint8") heat = 0;
  @type("float32") held = 0;
  @type("string") heldBy = "";
  @type("boolean") copActive = false;
  @type("float32") copX = 0;
  @type("float32") copY = 0;
  @type("float32") copHeading = 0;
  /** An agbero at a bus stop is demanding money from this danfo driver. */
  @type("boolean") demand = false;
  @type("boolean") agberoActive = false;
  @type("float32") agberoX = 0;
  @type("float32") agberoY = 0;
  @type("float32") agberoHeading = 0;
  /** Combat: carrying a weapon, health (0–100), rounds left, seconds left wrecked. */
  @type("boolean") armed = false;
  @type("uint8") health = 100;
  @type("uint8") ammo = 0;
  @type("float32") wrecked = 0;
}

export type RaceStatus = "lobby" | "countdown" | "racing" | "finished";

export class RaceState extends Schema {
  @type("string") lcda = "ikorodu-west";
  @type("string") status: RaceStatus = "lobby";
  @type("string") hostId = "";
  @type("string") winnerId = "";
  /** Whole seconds left in the countdown. */
  @type("uint8") countdown = 0;
  /** Seconds since the start signal. */
  @type("float32") raceTime = 0;
  /** Seconds left before the race closes once someone has finished. */
  @type("float32") closesIn = 0;
  @type("string") startNodeId = "";
  @type("string") finishNodeId = "";
  @type("float32") startX = 0;
  @type("float32") startY = 0;
  @type("float32") startHeading = 0;
  @type("float32") finishX = 0;
  @type("float32") finishY = 0;
  @type("float32") routeLength = 0;
  /** The host can switch potholes off for a smooth-roads race. */
  @type("boolean") potholes = true;
  /** Rush-hour go-slow at the famous hotspots. */
  @type("boolean") goSlow = false;
  /** The host can switch weapons off for a pure race. */
  @type("boolean") weapons = true;
  @type({ map: Racer }) players = new MapSchema<Racer>();
}
