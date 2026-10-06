# Lagos Road Racer

Browser-based multiplayer street racing on the real roads of Ikorodu, Lagos, built from OpenStreetMap data.

- `tools/`: map pipeline (Overpass → local metres → road graph → potholes, buildings and trees). One JSON file per LCDA.
- `client/`: Vite + React + TypeScript + React Three Fiber. Garage, free drive, race lobby and races.
- `server/`: Colyseus race server. Server-authoritative positions, progress, finish and winner.
- `shared/`: car stats, driving physics, spatial index and routing, used by **both** client and server so they simulate identically.

## Run it locally

You need Node.js 20 or newer (22 recommended).

```bash
npm install                          # once
npm run map:build -- ikorodu-west    # once: downloads OSM roads and builds the map (1–3 min)
npm run dev                          # starts the race server (:2567) and the web client (:5173)
```

Open http://localhost:5173.

- **Free drive:** pick a car, then **Free drive**. W/↑ gas, S/↓/Space brake and reverse, A/D or ←/→ steer.
- **Multiplayer:** pick a car, then **Create multiplayer race**. Tap junctions to set the start and finish (or press 🎲 Random route), then **Create race & get link**. Open the link in a second browser window (or send it to a friend), pick a car, **Join**, and both press **I'm ready**.

### What's in the game

- **Cars:** *Lagos classics* (Danfo, Ikorodu Runner, Lekki GT, Keke, Okada) and *Luxury* (Lamborghini-, Ferrari-, Porsche-, G-Wagon- and Rolls-Royce-style cars under lookalike names), each with paint colours. Supercars are the fastest but suffer the most in potholes.
- **Real car looks:** each car is modelled on its real silhouette (Aventador wedge, 911 arc roofline, G-Class box, Phantom grille, T3 danfo). For exact replicas, drop `.glb` models into `client/public/cars/` (see the README there).
- **Potholes on/off:** a switch in the garage (free drive) and in the race lobby (the host's choice applies to every racer).
- **Estate gates and road blocks:** real `barrier=*` nodes from OSM (gates, lift gates, bollards…) on the roads they sit on, shown as red discs on the route map. Crawl through (under 25 km/h) and the gateman lifts the boom; ram it and you lose speed and gain police heat.
- **Real streets:** green street-name signs beside the road, street names on the minimap and route map, and the current road name above the speedometer.
- **Bridges:** creek bridges with concrete parapets, and the Lagos-style pedestrian overhead footbridges at their real OSM positions. Long bridges tagged as flyovers rise on ramps and pillars. Rivers and streams run under them.
- **Traffic and people:** danfos, cars, kekes and okadas drive the roads, and pedestrians walk the verges. Everyone sees the same traffic: it follows seeded routes, so the server and every player calculate identical positions.
- **Police:** crashing into traffic, scaring pedestrians and hitting walls fill the ★ wanted meter. At 3 stars a police car chases you with siren and lights. If it catches you while you're slow you're **BUSTED** (held 4 s). Stay 320 m away for 6 s to lose them.
- **Agbero (Danfo only):** at bus stops an agbero demands money. Stop beside him to pay. Drive off without paying and he chases you on an okada; if he catches you, you're held 5 s "paying double".
- **Races between LCDAs:** build a combined map, e.g. `npm run map:build -- ikorodu-west+ijede`. It appears in the garage as "Ikorodu West ↔ Ijede", and the lobby lets you pick the From and To LCDA.

### Play on your phone (same Wi-Fi)

`npm run dev` prints a `Network:` address such as `http://192.168.1.20:5173`. Open that on your phone. The client connects to the race server at the same address on port 2567 automatically. Race links you create from that address work for anyone on the same Wi-Fi. If the phone can't connect, allow ports 5173 and 2567 through your computer's firewall.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run map:list` | List configured LCDAs |
| `npm run map:build -- ijede` | Build another LCDA (uses the cached download on re-runs; add `--refresh` to re-download) |
| `npm run map:build -- ikorodu-west --seed my-seed` | Same roads, a different pothole/scenery layout |
| `npm run map:build -- ikorodu-west+ijede` | Combined map for races between two (or more) LCDAs. Large: about 14 MB for this pair |
| `npm run map:validate -- ikorodu-west` | Sanity-check a built map |
| `npm test` | Pipeline, physics and routing tests |
| `npm run server:dev` / `npm run client:dev` | Run just one side |
| `npm run client:build` / `npm run server:build` | Production builds |

`map:build` automatically copies the map to `client/public/maps` and `server/maps`. `npm run map:stage` does that copy on its own.

## How it works

- **Map pipeline:** fetches every `highway=*` way in the LCDA's bounding box, keeps drivable ones, clips them to the box, and projects lat/lng to metres around the area centre. It splits ways at shared nodes to build the junction graph and labels connected components (races only use the main network). Width comes from road type, and the unpaved flag from the `surface` tag. Potholes are placed with a seeded RNG: about 1 per 40 m on dirt roads, 1 per 70 m on residential streets, 1 per 450 m on primary roads. Buildings and trees are seeded the same way, so everything stays in the same place every time.
- **Driving:** a fixed-step (60 Hz) arcade model in `shared/sim.ts`. Potholes cut speed sharply (less for cars with better pothole resistance), shake the camera and play a thud. Leaving the road caps you at about a third of top speed. Dirt roads are slower. Buildings are solid.
- **Multiplayer:** clients send inputs 20 times a second. The server runs the same simulation and is the single source of truth for positions, distance-to-finish (shortest path over the road graph), places, finish and winner. Your own car uses client-side prediction with server reconciliation, so it responds instantly. Other cars are drawn about 110 ms in the past and interpolated, so they move smoothly. Only the start and finish are fixed; take any route you like.
- **Performance:** the world is split into 300 m tiles, and tiles beyond the fog are hidden. Buildings, trees and potholes are instanced. Materials are cheap Lambert, with no real-time shadows. Resolution scales down automatically if the frame rate drops.

## Adding LCDAs

Edit `tools/areas.json`. Ikorodu West, Ijede, Imota, Igbogbo/Bayeku and Ikorodu North are already configured with approximate bounding boxes. Refine them against official boundaries if needed, then run `npm run map:build -- <slug>`. Every built map shows up in the garage's LCDA picker.

## Deploying (Docker)

After building your maps, run `docker compose up --build` and open http://localhost:8080. For a public deployment, build the client with `VITE_COLYSEUS_URL=wss://your-race-server` (see `docker-compose.yml`) and put the race server behind TLS.

Map data © OpenStreetMap contributors, available under the ODbL. The credit is shown in the garage and during every drive.
