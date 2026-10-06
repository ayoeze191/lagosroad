import { Client } from "@colyseus/sdk";

/** Race server URL. Defaults to the page's host on port 2567, so phones on the same Wi-Fi just work. */
export const serverUrl = import.meta.env.VITE_COLYSEUS_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;

export const createClient = () => new Client(serverUrl);

export const raceLink = (lcda: string, roomId: string) => `${location.origin}/race/${lcda}/${roomId}`;
