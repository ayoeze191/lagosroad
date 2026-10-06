import { useEffect, useState } from "react";
import { audio } from "./audio";

/** Pidgin callouts for the big moments: shown big on screen and spoken (if the device has a voice). */
const LINES = {
  chase: ["Police don see you o!", "Wahala dey! Police dey come!", "Na chase be this o!"],
  busted: ["Dem don catch you!", "Oga, park well!", "Wetin you go explain now?"],
  escaped: ["You don lose them!", "You see as you take escape?"],
  rammed: ["Police don jam you!", "Hold body!"],
  pedestrian: ["Ah! You wan kill person?!", "Oga, you no get eye?!", "Eyaa! Police go hear this one!"],
  nearMiss: ["Small small o!", "Driver, take am easy!", "Ehn! E remain small!"],
  barrier: ["You don break the gate!", "Gateman go report you o!"],
  pothole: ["Pothole don chop your tyre!", "Ah, this Lagos road!"],
  agbero: ["Agbero dey come for you!", "Owo da? Pay the man!"],
  win: ["You don win am!", "Oga of the road!"],
  hit: ["E don touch am!", "Direct hit!"],
  wrecked: ["Your motor don scatter!", "Ah, them don finish you!"],
  shot: ["Dem dey shoot you o!", "Bullet don touch your motor!"],
  wreckedThem: ["You don scatter their motor!", "Na you be the boss!"]
} as const;
export type Callout = keyof typeof LINES;

const MIN_GAP = 2500, CHANCE: Partial<Record<Callout, number>> = { pothole: 0.2, nearMiss: 0.5, hit: 0.5 };
let last = 0;
const listeners = new Set<(text: string) => void>();
let voice: SpeechSynthesisVoice | undefined;
function pickVoice() {
  const voices = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  voice = voices.find((v) => v.lang === "en-NG") || voices.find((v) => v.lang === "en-GB") || voices.find((v) => v.lang.startsWith("en"));
}
if (typeof speechSynthesis !== "undefined") { pickVoice(); speechSynthesis.addEventListener?.("voiceschanged", pickVoice); }

export function callout(kind: Callout, force = false) {
  const now = performance.now();
  if (!force && (now - last < MIN_GAP || Math.random() > (CHANCE[kind] ?? 1))) return;
  last = now;
  const options = LINES[kind], text = options[Math.floor(Math.random() * options.length)];
  listeners.forEach((l) => l(text));
  if (audio.muted || typeof speechSynthesis === "undefined") return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.08; u.pitch = 1.05; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

/** The latest callout text (clears itself after a couple of seconds), for the HUD. */
export function useCallout() {
  const [text, setText] = useState<{ text: string; at: number }>();
  useEffect(() => {
    let timer = 0;
    const show = (t: string) => { setText({ text: t, at: performance.now() }); clearTimeout(timer); timer = window.setTimeout(() => setText(undefined), 2200); };
    listeners.add(show);
    return () => { listeners.delete(show); clearTimeout(timer); };
  }, []);
  return text;
}
