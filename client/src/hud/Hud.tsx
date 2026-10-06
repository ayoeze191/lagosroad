import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { MAJOR_HIGHWAYS, type MapData } from "../../../shared/types.js";
import type { Follow } from "../game/ChaseCamera";
import { audio } from "../game/audio";
import { useCallout } from "../game/callouts";
import { labelAnchors } from "../world/labels";

export type Marker = { x: number; y: number; colour: string; kind: "car" | "finish" | "start" | "police" | "agbero" };

const PX_PER_M = 1 / 3;
const roadCanvasCache = new WeakMap<MapData, HTMLCanvasElement>();

/** Pre-render the whole road network once; the minimap just crops and rotates it. */
function roadCanvas(map: MapData) {
  let canvas = roadCanvasCache.get(map);
  if (canvas) return canvas;
  const e = map.extent;
  canvas = document.createElement("canvas");
  canvas.width = Math.ceil((e.maxX - e.minX) * PX_PER_M) + 4;
  canvas.height = Math.ceil((e.maxY - e.minY) * PX_PER_M) + 4;
  const ctx = canvas.getContext("2d")!;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const pass of [0, 1]) for (const road of map.roads) {
    const major = MAJOR_HIGHWAYS.has(road.highway);
    if ((pass === 1) !== major) continue;
    ctx.strokeStyle = major ? "#eef2ff" : road.paved ? "#6c7390" : "#6b5440";
    ctx.lineWidth = Math.max(1.5, road.width * PX_PER_M * (major ? 1.1 : 1));
    ctx.beginPath();
    road.points.forEach((p, i) => {
      const x = (p.x - e.minX) * PX_PER_M + 2, y = (e.maxY - p.y) * PX_PER_M + 2;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  roadCanvasCache.set(map, canvas);
  return canvas;
}

/** Heading-up minimap around the player, with markers for the finish and other racers. */
export function MiniMap({ map, follow, markers }: { map: MapData; follow: MutableRefObject<Follow>; markers: MutableRefObject<Marker[]> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext("2d")!, roads = roadCanvas(map), e = map.extent, anchors = labelAnchors(map);
    const size = canvas.width, zoom = 2.2; // canvas px per road-canvas px
    let raf = 0, last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return; // 20 fps is plenty for a minimap
      last = now;
      const f = follow.current;
      const px = (f.x - e.minX) * PX_PER_M + 2, py = (e.maxY - f.y) * PX_PER_M + 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.translate(size / 2, size * 0.62);
      ctx.rotate(-f.heading);
      ctx.scale(zoom, zoom);
      ctx.drawImage(roads, -px, -py);
      for (const m of markers.current) {
        const mx = (m.x - e.minX) * PX_PER_M + 2 - px, my = (e.maxY - m.y) * PX_PER_M + 2 - py;
        ctx.fillStyle = m.colour;
        ctx.beginPath();
        ctx.arc(mx, my, m.kind === "finish" || m.kind === "start" ? 6 / zoom * 1.6 : 3 / zoom * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // Street names, upright, for the nearest few named roads in view.
      const radius = size * 0.5 / (PX_PER_M * zoom), cos = Math.cos(-f.heading), sin = Math.sin(-f.heading);
      const placed: [number, number, number][] = [];
      ctx.font = "600 9px system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = "#07080c"; ctx.fillStyle = "#cfe9ff";
      for (const a of anchors) {
        const dx = a.x - f.x, dy = a.y - f.y;
        if (Math.abs(dx) > radius || Math.abs(dy) > radius) continue;
        // map (dx, -dy) rotated by -heading, scaled into minimap pixels
        const px0 = dx * PX_PER_M * zoom, py0 = -dy * PX_PER_M * zoom;
        const sx = size / 2 + px0 * cos - py0 * sin, sy = size * 0.62 + px0 * sin + py0 * cos;
        if (sx < 14 || sx > size - 14 || sy < 10 || sy > size - 10) continue;
        const text = a.name.length > 18 ? `${a.name.slice(0, 17)}…` : a.name;
        const w = ctx.measureText(text).width / 2 + 3;
        if (placed.some(([x, y, pw]) => Math.abs(x - sx) < w + pw && Math.abs(y - sy) < 11)) continue;
        placed.push([sx, sy, w]);
        ctx.strokeText(text, sx, sy);
        ctx.fillText(text, sx, sy);
        if (placed.length >= 5) break;
      }
      // Edge arrows for markers that are off the minimap.
      for (const m of markers.current) {
        if (m.kind !== "finish") continue;
        const dx = m.x - f.x, dy = m.y - f.y, a = Math.atan2(dx, dy) - f.heading;
        const dist = Math.hypot(dx, dy) * PX_PER_M * zoom;
        if (dist < size * 0.38) continue;
        ctx.save();
        ctx.translate(size / 2 + Math.sin(a) * size * 0.4, size * 0.62 - Math.cos(a) * size * 0.4);
        ctx.rotate(a);
        ctx.fillStyle = m.colour;
        ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "#19e3ff";
      ctx.beginPath();
      ctx.moveTo(size / 2, size * 0.62 - 8); ctx.lineTo(size / 2 + 5, size * 0.62 + 5); ctx.lineTo(size / 2 - 5, size * 0.62 + 5);
      ctx.closePath(); ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, follow, markers]);
  return <canvas ref={ref} className="minimap" width={160} height={160} />;
}

const GEARS = 6;
const polar = (deg: number, r: number) => { const a = (deg - 90) * Math.PI / 180; return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r]; };
const arcPath = (from: number, to: number, r: number) => {
  const [x1, y1] = polar(from, r), [x2, y2] = polar(to, r);
  return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};
const START = -135, SWEEP = 270;

/** NFS-style speedometer: ticked dial with needle, RPM ring, gear and big digital speed. ~15 fps, no per-frame React. */
export function Dashboard({ follow, roadName }: { follow: MutableRefObject<Follow>; roadName: MutableRefObject<string> }) {
  const [view, setView] = useState({ kmh: 0, ratio: 0, rpm: 0, gear: "N", road: "" });
  const max = Math.max(120, Math.ceil(follow.current.topSpeed * 3.6 / 40) * 40 + 20);
  useEffect(() => {
    const timer = setInterval(() => {
      const f = follow.current, kmh = Math.abs(f.speed) * 3.6, ratio = Math.min(1, Math.abs(f.speed) / f.topSpeed);
      // Fake gearbox: six evenly spaced gears, revs climb within each.
      const g = Math.min(GEARS - 1, Math.floor(ratio * GEARS * 0.999));
      const rpm = f.speed < -0.3 ? 0.5 : kmh < 1 ? 0.12 : Math.min(1, 0.3 + 0.7 * (ratio * GEARS - g));
      setView({ kmh: Math.round(kmh), ratio: kmh / max, rpm, gear: f.speed < -0.3 ? "R" : kmh < 1 ? "N" : String(g + 1), road: roadName.current });
    }, 66);
    return () => clearInterval(timer);
  }, [follow, roadName, max]);
  const ticks = [];
  for (let v = 0; v <= max; v += 10) {
    const deg = START + SWEEP * v / max, major = v % 40 === 0;
    const [x1, y1] = polar(deg, major ? 70 : 74), [x2, y2] = polar(deg, 80);
    ticks.push(<line key={v} x1={x1} y1={y1} x2={x2} y2={y2} className={`tick ${major ? "major" : ""}`} />);
    if (major) { const [lx, ly] = polar(deg, 60); ticks.push(<text key={`l${v}`} x={lx} y={ly} className="label">{v}</text>); }
  }
  const needle = START + SWEEP * Math.min(1, view.ratio);
  const [nx, ny] = polar(needle, 78), [bx, by] = polar(needle, 46);
  return <>
    <div className="speedo">
      <svg viewBox="0 0 200 200">
        <defs><linearGradient id="speedGrad" x1="0" x2="1"><stop offset="0" stopColor="#19e3ff" /><stop offset="0.6" stopColor="#ff2e88" /><stop offset="1" stopColor="#ff3b4e" /></linearGradient></defs>
        <circle cx="100" cy="100" r="92" className="face" />
        <path d={arcPath(START, START + SWEEP, 86)} className="track" />
        {view.ratio > 0.005 && <path d={arcPath(START, START + SWEEP * Math.min(1, view.ratio), 86)} className="fill" />}
        {view.rpm > 0.01 && <path d={arcPath(START, START + SWEEP * view.rpm, 93)} className="rpm" style={{ stroke: view.rpm > 0.88 ? "#ff3b4e" : undefined }} />}
        {ticks}
        <line x1={bx} y1={by} x2={nx} y2={ny} className="needle" />
      </svg>
      <div className="readout"><b>{view.kmh}</b><small>KM/H</small></div>
      <div className={`gear ${view.gear === "R" ? "r" : ""}`}>{view.gear}</div>
    </div>
    {view.road && <div className="road-name">{view.road}</div>}
  </>;
}

/** NFS-style shout-out for the big moments (pidgin), from game/callouts. */
export function CalloutHud() {
  const c = useCallout();
  return c ? <div className="callout" key={c.at}>{c.text}</div> : null;
}

export function MuteButton() {
  const [muted, setMuted] = useState(audio.muted);
  return <button className="chip" onClick={() => { audio.setMuted(!muted); setMuted(!muted); }} aria-label="Toggle sound">{muted ? "🔇" : "🔊"}</button>;
}

export function Attribution({ map }: { map: MapData }) {
  return <a className="osm" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{map.source.attribution}</a>;
}

export type LawView = { heat: number; held: number; heldBy: string; copActive: boolean; copDistance: number; demand: boolean; agberoActive: boolean };

/** Wanted meter plus the big messages for police chases and agbero trouble. */
export function LawHud({ law }: { law: LawView }) {
  const stars = Math.min(5, Math.ceil(law.heat / 20));
  let message: { text: string; tone: string } | undefined;
  if (law.held > 0) message = law.heldBy === "agbero"
    ? { text: `Agbero don hold you! Paying double… ${Math.ceil(law.held)}s`, tone: "agbero" }
    : { text: `🚔 BUSTED! Police holding you ${Math.ceil(law.held)}s`, tone: "police" };
  else if (law.copActive) message = { text: `🚨 Police dey chase you! ${Math.round(law.copDistance)} m`, tone: "police" };
  else if (law.agberoActive) message = { text: "🛵 Agbero dey chase you on okada! Run!", tone: "agbero" };
  else if (law.demand) message = { text: "Agbero dey demand owo! Stop beside him to pay", tone: "agbero" };
  return <>
    {law.heat > 0 && <div className="wanted" title="Rough driving attracts the police">{"★".repeat(stars)}<span>{"★".repeat(5 - stars)}</span></div>}
    {message && <div className={`law-banner ${message.tone}`}>{message.text}</div>}
  </>;
}
