import type { Room } from "@colyseus/sdk";
import { useCallback, useMemo, useState } from "react";
import type { CarSpec } from "../../../shared/cars.js";
import { distancesFrom, randomRace } from "../../../shared/route.js";
import { regionAt, type MapData, type Place, type Point } from "../../../shared/types.js";
import { mapTools } from "../game/mapIndex";
import { createClient } from "../net";
import { MapPicker } from "./MapPicker";

/** Name of a junction, from the named roads that meet there. */
export function junctionName(map: MapData, nodeId: string) {
  // Lagosians give directions by bus stop or landmark, so prefer a named place nearby.
  const node = map.graph.nodes.find((n) => n.id === nodeId);
  const place = node && nearestPlace(map, node.position, 160);
  if (place) return place.name;
  const names = new Set<string>();
  map.graph.edges.forEach((e, i) => { if ((e.from === nodeId || e.to === nodeId) && map.roads[i].name !== "Unnamed road") names.add(map.roads[i].name); });
  const list = [...names];
  return list.length ? list.slice(0, 2).join(" / ") : "Unnamed junction";
}

const PLACE_RANK: Record<Place["kind"], number> = { bus_stop: 0, landmark: 1, spot: 2, area: 3 };
/** Best named place within `radius` metres: bus stops beat landmarks beat filling stations/churches beat area names. */
export function nearestPlace(map: MapData, p: Point, radius: number) {
  let best: Place | undefined, bestScore = Infinity;
  for (const place of map.places || []) {
    const d = Math.hypot(place.x - p.x, place.y - p.y);
    if (d > (place.kind === "area" ? radius * 4 : radius)) continue;
    const score = PLACE_RANK[place.kind] * 1000 + d;
    if (score < bestScore) { bestScore = score; best = place; }
  }
  return best;
}

/** The main-network junction nearest a point. */
function nearestNode(map: MapData, p: Point) {
  let best: string | undefined, bestD = Infinity;
  for (const n of map.graph.nodes) {
    if (n.component !== map.mainComponent) continue;
    const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

/** Which LCDA a junction is in (combined maps only). */
export function regionName(map: MapData, nodeId: string) {
  const node = map.graph.nodes.find((n) => n.id === nodeId);
  const i = node ? regionAt(map, node.position) : -1;
  return i >= 0 ? map.regions![i].name : "";
}

export function Lobby({ map, car, armed, name, potholes, onPotholes, goSlow, onGoSlow, onBack, onCreated }: {
  map: MapData; car: CarSpec; armed: boolean; name: string; potholes: boolean; onPotholes: (on: boolean) => void; goSlow: boolean; onGoSlow: (on: boolean) => void; onBack: () => void; onCreated: (room: Room) => void;
}) {
  const { graph } = mapTools(map);
  const regions = map.regions || [];
  const multi = regions.length > 1;
  // On a combined map, default to racing from the first LCDA to the second.
  const [between, setBetween] = useState<[number, number]>([0, Math.min(1, regions.length - 1)]);
  const roll = (b = between) => (multi ? randomRace(map, graph, undefined, 2500, 12000, b) : randomRace(map, graph));
  const [pair, setPair] = useState(() => roll() || { start: "", finish: "", length: 0 });
  const [mode, setMode] = useState<"start" | "finish">("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [weapons, setWeapons] = useState(true);
  const placeNames = useMemo(() => [...new Set((map.places || []).map((p) => p.name))].sort(), [map]);

  const length = useMemo(() => {
    const s = graph.nodeIndex.get(pair.start), f = graph.nodeIndex.get(pair.finish);
    if (s === undefined || f === undefined) return undefined;
    return distancesFrom(graph, f)[s];
  }, [graph, pair.start, pair.finish]);

  const pick = useCallback((id: string) => {
    setPair((p) => (mode === "start" ? { ...p, start: id } : { ...p, finish: id }));
    setMode((m) => (m === "start" ? "finish" : "start"));
    setError("");
  }, [mode]);

  const create = async () => {
    if (!length || !Number.isFinite(length) || length < 300) return setError("Pick a finish at least 300 m from the start by road.");
    setBusy(true);
    setError("");
    try {
      const room = await createClient().create("race", { lcda: map.area.slug, startNodeId: pair.start, finishNodeId: pair.finish, name, carId: car.id, colour: car.colour, potholes, goSlow, weapons, armed });
      onCreated(room);
    } catch (e) {
      setError(e instanceof Error && e.message ? `Could not reach the race server: ${e.message}. Is it running (npm run dev)?` : "Could not reach the race server. Is it running?");
      setBusy(false);
    }
  };

  return <main className="lobby">
    <header className="lobby-head">
      <button className="chip" onClick={onBack}>← Back</button>
      <div>
        <p className="eyebrow">NEW RACE · {map.area.name}</p>
        <h1>Set the route</h1>
      </div>
    </header>
    <div className="lobby-body">
      <MapPicker map={map} start={pair.start} finish={pair.finish} onPick={pick} goSlow={goSlow} />
      <aside className="lobby-side">
        <div className="mode">
          <button className={mode === "start" ? "on start" : ""} onClick={() => setMode("start")}>Set start</button>
          <button className={mode === "finish" ? "on finish" : ""} onClick={() => setMode("finish")}>Set finish</button>
        </div>
        <p className="hint">Tap a junction on the map to set the <b>{mode}</b>, or search for a bus stop or landmark. Drag to pan, pinch or scroll to zoom.</p>
        {placeNames.length > 0 && <input className="place-search" list="lrr-places" placeholder={`🔎 ${mode === "start" ? "Start" : "Finish"} at… (e.g. a bus stop)`} value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            const place = (map.places || []).find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
            const id = place && nearestNode(map, place);
            if (id) { pick(id); setSearch(""); }
          }} />}
        <datalist id="lrr-places">{placeNames.map((n) => <option key={n} value={n} />)}</datalist>
        <dl className="route">
          <dt><span className="dot start" />Start</dt><dd>{pair.start ? junctionName(map, pair.start) : "—"}{multi && pair.start && <small className="region">{regionName(map, pair.start)}</small>}</dd>
          <dt><span className="dot finish" />Finish</dt><dd>{pair.finish ? junctionName(map, pair.finish) : "—"}{multi && pair.finish && <small className="region">{regionName(map, pair.finish)}</small>}</dd>
          <dt>Shortest route</dt><dd>{length && Number.isFinite(length) ? `${(length / 1000).toFixed(2)} km` : "—"}</dd>
        </dl>
        {(map.barriers?.length || 0) > 0 && <p className="hint"><span className="gate-dot" /> {map.barriers!.length} real estate gates and road blocks (from OpenStreetMap). Crawl through and the gateman lifts the boom; ram it and you lose speed and the police notice.</p>}
        <PotholeSwitch on={potholes} onChange={onPotholes} />
        <Toggle label="Go-slow" on={goSlow} onChange={onGoSlow} yes="🚦 Rush hour" no="Free roads" />
        <Toggle label="Weapons" on={weapons} onChange={setWeapons} yes="🔫 Allowed" no="Off" />
        <p className="hint">{potholes ? "Only the start and finish are fixed. Any road is fair game, so a side street can beat a pothole-filled main road." : "Smooth roads: every racer drives without potholes. Estate gates still need slowing down for."}</p>
        {multi && <div className="between">
          <label>From<select value={between[0]} onChange={(e) => { const b: [number, number] = [+e.target.value, between[1]]; setBetween(b); const r = roll(b); if (r) setPair(r); }}>
            {regions.map((r, i) => <option key={r.slug} value={i}>{r.name}</option>)}</select></label>
          <label>To<select value={between[1]} onChange={(e) => { const b: [number, number] = [between[0], +e.target.value]; setBetween(b); const r = roll(b); if (r) setPair(r); }}>
            {regions.map((r, i) => <option key={r.slug} value={i}>{r.name}</option>)}</select></label>
        </div>}
        <button onClick={() => { const r = roll(); if (r) setPair(r); else setError("No route found between those areas; try again or pick junctions by hand."); }}>🎲 Random route</button>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create race & get link"}</button>
      </aside>
    </div>
  </main>;
}

/** Potholes on (real roads) or off (smooth), for free drive and for a race the host creates. */
export function PotholeSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return <div className="pothole-switch" role="radiogroup" aria-label="Potholes">
    <span>Potholes</span>
    <button role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => onChange(true)}>🕳️ On</button>
    <button role="radio" aria-checked={!on} className={!on ? "on" : ""} onClick={() => onChange(false)}>✨ Off</button>
  </div>;
}

/** Two-way switch styled like the potholes one. */
export function Toggle({ label, on, onChange, yes, no }: { label: string; on: boolean; onChange: (on: boolean) => void; yes: string; no: string }) {
  return <div className="pothole-switch" role="radiogroup" aria-label={label}>
    <span>{label}</span>
    <button role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => onChange(true)}>{yes}</button>
    <button role="radio" aria-checked={!on} className={!on ? "on" : ""} onClick={() => onChange(false)}>{no}</button>
  </div>;
}
