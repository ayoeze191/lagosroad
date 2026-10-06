import { useEffect, useMemo, useRef } from "react";
import { MAJOR_HIGHWAYS, type MapData, type Point } from "../../../shared/types.js";
import { labelAnchors } from "../world/labels";

type View = { cx: number; cy: number; scale: number };

/** Pan/zoom road map. Tap near a junction to pick it (only junctions on the main network). */
export function MapPicker({ map, start, finish, onPick, goSlow }: { map: MapData; start: string; finish: string; onPick: (nodeId: string) => void; goSlow?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ cx: 0, cy: 0, scale: 0.1 });
  const nodes = useMemo(() => map.graph.nodes.filter((n) => n.component === map.mainComponent), [map]);
  const byId = useMemo(() => new Map(map.graph.nodes.map((n) => [n.id, n])), [map]);
  const redraw = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = canvas.current!, ctx = el.getContext("2d")!;
    const e = map.extent;
    const fit = () => {
      const rect = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      el.width = rect.width * dpr; el.height = rect.height * dpr;
      if (view.current.scale === 0.1) view.current = { cx: (e.minX + e.maxX) / 2, cy: (e.minY + e.maxY) / 2, scale: Math.min(el.width / (e.maxX - e.minX), el.height / (e.maxY - e.minY)) * 0.95 };
    };
    const toScreen = (p: Point) => [(p.x - view.current.cx) * view.current.scale + el.width / 2, -(p.y - view.current.cy) * view.current.scale + el.height / 2];
    let pending = 0;
    const draw = () => {
      pending = 0;
      const v = view.current;
      ctx.fillStyle = "#101713";
      ctx.fillRect(0, 0, el.width, el.height);
      ctx.lineCap = ctx.lineJoin = "round";
      const halfW = el.width / 2 / v.scale, halfH = el.height / 2 / v.scale;
      for (const major of [false, true]) {
        ctx.strokeStyle = major ? "#f3c85a" : "#b9b5a6";
        ctx.lineWidth = Math.max(major ? 1.6 : 0.8, (major ? 11 : 5) * v.scale);
        ctx.beginPath();
        for (const road of map.roads) {
          if (MAJOR_HIGHWAYS.has(road.highway) !== major) continue;
          const a = road.points[0];
          if (Math.abs(a.x - v.cx) > halfW + 600 || Math.abs(a.y - v.cy) > halfH + 600) continue;
          road.points.forEach((p, i) => { const [x, y] = toScreen(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        }
        ctx.stroke();
      }
      const dpr = el.width / el.getBoundingClientRect().width || 1;
      // LCDA boundaries (approximate boxes) on combined maps.
      if ((map.regions?.length || 0) > 1) {
        const tints = ["#34c75955", "#ff9f0a55", "#0a84ff55", "#bf5af255", "#ff375f55"];
        map.regions!.forEach((r, i) => {
          const [x1, y1] = toScreen({ x: r.bounds.minX, y: r.bounds.maxY }), [x2, y2] = toScreen({ x: r.bounds.maxX, y: r.bounds.minY });
          ctx.strokeStyle = tints[i % tints.length].slice(0, 7); ctx.lineWidth = 2 * dpr; ctx.setLineDash([8 * dpr, 6 * dpr]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);
          ctx.fillStyle = tints[i % tints.length].slice(0, 7);
          ctx.font = `800 ${13 * dpr}px system-ui`; ctx.textAlign = "left"; ctx.textBaseline = "top";
          ctx.fillText(r.name, x1 + 6 * dpr, y1 + 6 * dpr);
        });
      }
      // Street names once zoomed in enough to read them; skip any that would overlap.
      if (v.scale > 0.35 * dpr) {
        ctx.font = `600 ${11 * dpr}px system-ui`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#101713"; ctx.fillStyle = "#e9f5ec";
        const placed: [number, number, number, number][] = [];
        for (const a of labelAnchors(map)) {
          const [x, y] = toScreen(a);
          if (x < 0 || y < 0 || x > el.width || y > el.height) continue;
          const w = ctx.measureText(a.name).width / 2 + 4 * dpr, h = 8 * dpr;
          if (placed.some(([px, py, pw, ph]) => Math.abs(px - x) < pw + w && Math.abs(py - y) < ph + h)) continue;
          placed.push([x, y, w, h]);
          ctx.strokeText(a.name, x, y);
          ctx.fillText(a.name, x, y);
        }
      }
      // Go-slow zones (when rush hour is on).
      if (goSlow) for (const j of map.jams || []) {
        const [x, y] = toScreen(j);
        ctx.fillStyle = "#ff3b4e33"; ctx.strokeStyle = "#ff3b4e"; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(x, y, j.radius * v.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ff8b97"; ctx.font = `800 ${11 * dpr}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`GO-SLOW · ${j.name.replace(/ bus stop$/i, "")}`, x, y - j.radius * v.scale - 8 * dpr);
      }
      // Bus stops and landmarks: how Lagosians actually find their way.
      for (const p of map.places || []) {
        if (p.kind === "area" || (p.kind !== "landmark" && v.scale < 0.3 * dpr)) continue;
        const [x, y] = toScreen(p);
        if (x < 0 || y < 0 || x > el.width || y > el.height) continue;
        ctx.fillStyle = p.kind === "bus_stop" ? "#ffd23f" : p.kind === "landmark" ? "#19e3ff" : "#c7a8ff";
        ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
        if (v.scale > 0.45 * dpr || p.kind === "landmark") {
          ctx.font = `700 ${10 * dpr}px system-ui`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "#101713"; ctx.strokeText(p.name, x + 6 * dpr, y); ctx.fillText(p.name, x + 6 * dpr, y);
        }
      }
      // Real gates and road blocks from OSM: red/white "no entry" discs, so racers can plan around them.
      const gateR = Math.max(4, Math.min(8, 9 * v.scale)) * dpr;
      for (const b of map.barriers || []) {
        const [x, y] = toScreen(b.position);
        if (x < -10 || y < -10 || x > el.width + 10 || y > el.height + 10) continue;
        ctx.fillStyle = "#e5262b";
        ctx.beginPath(); ctx.arc(x, y, gateR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - gateR * 0.6, y - gateR * 0.2, gateR * 1.2, gateR * 0.4);
      }
      for (const [id, colour, label] of [[start, "#34c759", "S"], [finish, "#ff453a", "F"]] as const) {
        const node = byId.get(id);
        if (!node) continue;
        const [x, y] = toScreen(node.position);
        ctx.fillStyle = colour;
        ctx.beginPath(); ctx.arc(x, y, 11 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#101713";
        ctx.font = `bold ${12 * dpr}px system-ui`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 0.5);
      }
    };
    redraw.current = () => { if (!pending) pending = requestAnimationFrame(draw); };
    fit(); draw();
    const resize = () => { fit(); redraw.current(); };
    addEventListener("resize", resize);
    return () => { removeEventListener("resize", resize); cancelAnimationFrame(pending); };
  }, [map, start, finish, byId, goSlow]);

  // Gestures: one finger pans (or taps), two fingers pinch, wheel zooms.
  useEffect(() => {
    const el = canvas.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0;
    const scaleFactor = () => el.width / el.getBoundingClientRect().width || 1;
    const zoomAt = (factor: number, sx: number, sy: number) => {
      const v = view.current, k = scaleFactor();
      const mx = v.cx + (sx * k - el.width / 2) / v.scale, my = v.cy - (sy * k - el.height / 2) / v.scale;
      v.scale = Math.max(0.02, Math.min(3, v.scale * factor));
      v.cx = mx - (sx * k - el.width / 2) / v.scale;
      v.cy = my + (sy * k - el.height / 2) / v.scale;
      redraw.current();
    };
    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 1) moved = 0;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); moved = 99; }
    };
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.offsetX, y: e.offsetY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 1) {
        const k = scaleFactor(), v = view.current;
        moved += Math.hypot(now.x - last.x, now.y - last.y);
        v.cx -= (now.x - last.x) * k / v.scale;
        v.cy += (now.y - last.y) * k / v.scale;
        redraw.current();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d;
      }
    };
    const up = (e: PointerEvent) => {
      const was = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size || !was || moved > 8) return;
      const v = view.current, k = scaleFactor();
      const p = { x: v.cx + (was.x * k - el.width / 2) / v.scale, y: v.cy - (was.y * k - el.height / 2) / v.scale };
      let best: { id: string; d: number } | undefined;
      for (const n of nodes) {
        const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
        if (!best || d < best.d) best = { id: n.id, d };
      }
      if (best && best.d * v.scale / k < 40) onPick(best.id);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [nodes, onPick]);

  const zoom = (f: number) => {
    const v = view.current;
    v.scale = Math.max(0.02, Math.min(3, v.scale * f));
    redraw.current();
  };
  return <div className="picker">
    <canvas ref={canvas} />
    <div className="picker-zoom"><button onClick={() => zoom(1.5)}>+</button><button onClick={() => zoom(1 / 1.5)}>−</button></div>
  </div>;
}
