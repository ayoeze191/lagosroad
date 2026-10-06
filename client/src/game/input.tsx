import { useEffect, useRef } from "react";
import type { Controls } from "../../../shared/sim.js";

type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };
const KEYMAP: Record<string, keyof Keys> = {
  w: "up", arrowup: "up", s: "down", arrowdown: "down", " ": "down",
  a: "left", arrowleft: "left", d: "right", arrowright: "right"
};

export type ControlSource = { read: () => Controls; keys: Keys };

/** Keyboard + on-screen touch share one key state; `read()` turns it into sim controls. */
export function useControls(): ControlSource {
  const keys = useRef<Keys>({ up: false, down: false, left: false, right: false });
  useEffect(() => {
    const set = (e: KeyboardEvent, value: boolean) => {
      const k = KEYMAP[e.key.toLowerCase()];
      if (!k) return;
      if (e.target instanceof HTMLInputElement) return;
      keys.current[k] = value;
      e.preventDefault();
    };
    const down = (e: KeyboardEvent) => set(e, true), up = (e: KeyboardEvent) => set(e, false);
    const blur = () => Object.assign(keys.current, { up: false, down: false, left: false, right: false });
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); };
  }, []);
  const source = useRef<ControlSource>({
    keys: keys.current,
    read: () => {
      const k = keys.current;
      return { throttle: (k.up ? 1 : 0) - (k.down ? 1 : 0), steer: (k.right ? 1 : 0) - (k.left ? 1 : 0) };
    }
  });
  return source.current;
}

function Pad({ keys, name, label, className }: { keys: Keys; name: keyof Keys; label: string; className?: string }) {
  const press = (value: boolean) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (value) e.currentTarget.setPointerCapture(e.pointerId);
    keys[name] = value;
    e.currentTarget.classList.toggle("down", value);
  };
  return <button className={`pad ${className || ""}`} aria-label={name}
    onPointerDown={press(true)} onPointerUp={press(false)} onPointerCancel={press(false)} onLostPointerCapture={press(false)}
    onContextMenu={(e) => e.preventDefault()}>{label}</button>;
}

export function TouchControls({ controls }: { controls: ControlSource }) {
  return <div className="touch">
    <div className="touch-side">
      <Pad keys={controls.keys} name="left" label="◀" />
      <Pad keys={controls.keys} name="right" label="▶" />
    </div>
    <div className="touch-side">
      <Pad keys={controls.keys} name="down" label="BRAKE" className="brake" />
      <Pad keys={controls.keys} name="up" label="GAS" className="gas" />
    </div>
  </div>;
}
