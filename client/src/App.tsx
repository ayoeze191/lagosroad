import type { Room } from "@colyseus/sdk";
import { lazy, Suspense, useEffect, useState } from "react";
import { CARS, withPaint, type CarClass, type CarSpec } from "../../shared/cars.js";
import type { MapData } from "../../shared/types.js";
import { WEAPONS, WRECK_SECONDS } from "../../shared/weapons.js";
import { Lobby, PotholeSwitch, Toggle } from "./screens/Lobby";

const FreeDrive = lazy(() => import("./screens/FreeDrive"));
const Race = lazy(() => import("./screens/Race"));
const CarPreview = lazy(() => import("./screens/CarPreview"));

type Screen = { name: "garage" } | { name: "menu" } | { name: "lobby" } | { name: "drive" } | { name: "race"; room?: Room; roomId?: string };
type AreaInfo = { slug: string; name: string };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }
};

const parseRoute = () => {
  const match = location.pathname.match(/^\/race\/([a-z0-9-]+)\/([A-Za-z0-9_-]+)\/?$/);
  return match ? { lcda: match[1], roomId: match[2] } : undefined;
};

/** Segmented NFS-style stat bar (10 blocks). */
function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat-row"><span>{label}</span><i>{Array.from({ length: 10 }, (_, k) => <b key={k} className={k < value ? "on" : ""} />)}</i></div>;
}

function Loading({ text }: { text: string }) {
  return <main className="setup loading">
    <div className="logo big"><b>LAGOS</b><span>ROAD RACER</span></div>
    <div className="loadbar"><i /></div>
    <p>{text}…</p>
  </main>;
}

export default function App() {
  const [invite, setInvite] = useState(parseRoute);
  const [lcda, setLcda] = useState(invite?.lcda || store.get("lrr:lcda") || "ikorodu-west");
  const [areas, setAreas] = useState<AreaInfo[]>([]);
  const [map, setMap] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [baseCar, setBaseCar] = useState<CarSpec>(() => CARS.find((c) => c.id === store.get("lrr:car")) || CARS.find((c) => c.id === "runner")!);
  const [paint, setPaint] = useState(() => store.get(`lrr:paint:${baseCar.id}`) || baseCar.colour);
  const [tab, setTab] = useState<CarClass>(baseCar.class);
  const car = withPaint(baseCar, paint);
  const pickCar = (c: CarSpec) => { setBaseCar(c); store.set("lrr:car", c.id); setPaint(store.get(`lrr:paint:${c.id}`) || c.colour); };
  const pickPaint = (colour: string) => { setPaint(colour); store.set(`lrr:paint:${baseCar.id}`, colour); };
  const [name, setName] = useState(() => store.get("lrr:name") || `Racer${Math.floor(Math.random() * 900 + 100)}`);
  const [screen, setScreen] = useState<Screen>({ name: "garage" });
  const [potholes, setPotholesState] = useState(() => store.get("lrr:potholes") !== "off");
  const setPotholes = (on: boolean) => { setPotholesState(on); store.set("lrr:potholes", on ? "on" : "off"); };
  // Weapon cars: armed or not, remembered per car (defaults to armed).
  const [armedTick, setArmedTick] = useState(0);
  const armed = !!car.weapon && store.get(`lrr:armed:${car.id}`) !== "off" && armedTick >= 0;
  const setArmed = (on: boolean) => { store.set(`lrr:armed:${car.id}`, on ? "on" : "off"); setArmedTick((t) => t + 1); };
  const [goSlow, setGoSlowState] = useState(() => store.get("lrr:goslow") === "on");
  const setGoSlow = (on: boolean) => { setGoSlowState(on); store.set("lrr:goslow", on ? "on" : "off"); };
  const [night, setNightState] = useState(() => store.get("lrr:time") !== "day");
  const setNight = (on: boolean) => { setNightState(on); store.set("lrr:time", on ? "night" : "day"); };

  useEffect(() => {
    fetch("/maps/index.json").then((r) => (r.ok ? r.json() : [])).then(setAreas).catch(() => setAreas([]));
  }, []);
  useEffect(() => {
    setMap(null);
    setError("");
    fetch(`/maps/${lcda}.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: MapData) => {
        if (data.schemaVersion !== 2) throw new Error("old");
        data.footbridges ??= []; // maps built before bridges/water were added
        data.water ??= [];
        setMap(data);
      })
      .catch(() => setError(lcda));
  }, [lcda]);

  // Enter starts free roam (or joins the invite) from the garage, like a console menu.
  useEffect(() => {
    if (screen.name !== "garage" || !map) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      setScreen(invite ? { name: "race", roomId: invite.roomId } : { name: "drive" });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [screen.name, map, invite]);

  const toGarage = () => { setInvite(undefined); history.replaceState(null, "", "/"); setScreen({ name: "garage" }); };

  if (error) return <main className="setup">
    <h1>Lagos Road Racer</h1>
    <p>The <b>{error}</b> map hasn't been built yet (or is from an older version). Build it with:</p>
    <pre>npm run map:build -- {error}</pre>
    <p className="muted">The game only uses real OpenStreetMap road data made by the map pipeline.</p>
    {areas.length > 0 && <button onClick={() => setLcda(areas[0].slug)}>Use {areas[0].name} instead</button>}
  </main>;
  if (!map) return <Loading text={`Loading ${lcda} roads`} />;

  const loading = <Loading text={`Building ${map.area.name}`} />;

  if (screen.name === "drive") return <Suspense fallback={loading}><FreeDrive map={map} car={car} potholes={potholes} night={night} goSlow={goSlow} onExit={toGarage} /></Suspense>;
  if (screen.name === "race") return <Suspense fallback={loading}><Race map={map} car={car} armed={armed} name={name} night={night} room={screen.room} roomId={screen.roomId} onExit={toGarage} /></Suspense>;
  if (screen.name === "lobby") return <Lobby map={map} car={car} armed={armed} name={name} potholes={potholes} onPotholes={setPotholes} goSlow={goSlow} onGoSlow={setGoSlow} onBack={() => setScreen({ name: "garage" })} onCreated={(room) => setScreen({ name: "race", room })} />;

  const kmh = Math.round(car.topSpeed * 3.6);
  const go = () => setScreen(invite ? { name: "race", roomId: invite.roomId } : { name: "drive" });
  return <main className="garage">
    <Suspense fallback={<div className="garage-stage" />}><CarPreview car={car} night={night} /></Suspense>
    <header className="topbar">
      <div className="logo"><b>LAGOS</b><span>ROAD RACER</span></div>
      <div className="garage-fields">
        <label><span>Driver</span>
          <input value={name} maxLength={16} onChange={(e) => { setName(e.target.value); store.set("lrr:name", e.target.value); }} />
        </label>
        {!invite && <label><span>LCDA</span>
          <select value={lcda} onChange={(e) => { setLcda(e.target.value); store.set("lrr:lcda", e.target.value); }}>
            {(areas.length ? areas : [{ slug: lcda, name: map.area.name }]).map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        </label>}
      </div>
    </header>

    <section className="garage-list">
      <p className="eyebrow">{invite ? "You've been invited to a race" : "Garage"}</p>
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === "classic" ? "on" : ""} onClick={() => setTab("classic")}><span>Lagos classics</span></button>
        <button role="tab" className={tab === "luxury" ? "on" : ""} onClick={() => setTab("luxury")}><span>Luxury</span></button>
      </div>
      <div className="cars">
        {CARS.filter((c) => c.class === tab).map((c) => <button key={c.id} className={`car-row ${c.id === car.id ? "picked" : ""}`} onClick={() => pickCar(c)}>
          <i style={{ background: c.id === car.id ? car.colour : c.colour }} />
          <span><strong>{c.name}{c.weapon ? " 🔫" : ""}</strong><small>{c.inspired}</small></span>
          <em>{Math.round(c.topSpeed * 3.6)}<small>km/h</small></em>
        </button>)}
      </div>
    </section>

    <section className="garage-spec">
      <p className="eyebrow">{car.class === "luxury" ? "Luxury" : "Lagos classic"}</p>
      <h1>{car.name}</h1>
      <p className="inspired">{car.inspired}</p>
      <p className="tagline">{car.tagline}</p>
      <div className="speed-tag"><b>{kmh}</b><span>KM/H<br />TOP SPEED</span></div>
      <Stat label="Top speed" value={Math.round(car.topSpeed / 5.4)} />
      <Stat label="Acceleration" value={Math.round(car.acceleration / 1.1)} />
      <Stat label="Handling" value={car.handling} />
      <Stat label="Pothole resistance" value={car.potholeResistance} />
      {car.body === "bus" && <p className="note">⚠ Agbero go collect money at every bus stop!</p>}
      {car.weapon && <>
        <Toggle label={car.weapon === "conductor" ? "Conductor" : car.weapon === "escort" ? "Escort" : "Turret"} on={armed} onChange={setArmed} yes="🔫 Armed" no="Unarmed" />
        <p className="hint weapon-hint">{WEAPONS[car.weapon].label}: multiplayer only. Steer your crosshair onto a rival and shoot to slow them down; enough hits and they're wrecked for {WRECK_SECONDS}s.</p>
      </>}
      {car.paints.length > 1 && <div className="paints">
        <span>Paint</span>
        {car.paints.map((p) => <button key={p} aria-label={`Paint ${p}`} className={p === car.colour ? "on" : ""} style={{ background: p }} onClick={() => pickPaint(p)} />)}
      </div>}
      {!invite && <PotholeSwitch on={potholes} onChange={setPotholes} />}
      {!invite && <Toggle label="Go-slow" on={goSlow} onChange={setGoSlow} yes="Rush hour" no="Free roads" />}
      <div className="pothole-switch" role="radiogroup" aria-label="Time of day">
        <span>Time</span>
        <button role="radio" aria-checked={night} className={night ? "on" : ""} onClick={() => setNight(true)}>Night</button>
        <button role="radio" aria-checked={!night} className={!night ? "on" : ""} onClick={() => setNight(false)}>Day</button>
      </div>
    </section>

    <footer className="garage-actions">
      <div className="actions">
        {invite
          ? <>
            <button className="primary" onClick={go}><span>Join race</span><kbd>Enter</kbd></button>
            <button onClick={toGarage}><span>Not now</span></button>
          </>
          : <>
            <button className="primary" onClick={go}><span>Free roam</span><kbd>Enter</kbd></button>
            <button className="primary alt" onClick={() => setScreen({ name: "lobby" })}><span>Multiplayer race</span></button>
          </>}
      </div>
      <p className="controls-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive · <kbd>Space</kbd> brake. Drive rough and the police will come for you.</p>
      <a className="osm static" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{map.source.attribution}</a>
    </footer>
  </main>;
}
