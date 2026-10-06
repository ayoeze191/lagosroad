import * as THREE from "three";
import { seededRandom } from "../../../shared/rng.js";

function noiseTexture(size: number, seed: string, paint: (ctx: CanvasRenderingContext2D, random: () => number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, seededRandom(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx: CanvasRenderingContext2D, random: () => number, size: number, count: number, colours: string[], maxR: number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[Math.floor(random() * colours.length)];
    const r = random() * maxR + 0.4;
    ctx.fillRect(random() * size, random() * size, r, r);
  }
}

/** Worn Lagos tarmac: grey with aggregate speckle, patches and a few cracks. */
export const asphaltTexture = () => noiseTexture(256, "asphalt", (ctx, random) => {
  ctx.fillStyle = "#4a4b4d";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = random() < 0.5 ? "rgba(30,30,32,0.25)" : "rgba(110,106,98,0.18)";
    ctx.beginPath();
    ctx.ellipse(random() * 256, random() * 256, 12 + random() * 40, 8 + random() * 26, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, random, 256, 2600, ["#414244", "#4f5052", "#46474a", "#3c3d40"], 0.9);
  ctx.strokeStyle = "rgba(20,20,20,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let x = random() * 256, y = random() * 256;
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (random() - 0.5) * 30; y += (random() - 0.5) * 30; ctx.lineTo(x, y); }
    ctx.stroke();
  }
});

/** Red laterite dirt road with ruts. */
export const dirtTexture = () => noiseTexture(256, "dirt", (ctx, random) => {
  ctx.fillStyle = "#9a5e3a";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = random() < 0.5 ? "rgba(120,70,40,0.35)" : "rgba(180,120,80,0.25)";
    ctx.beginPath();
    ctx.ellipse(random() * 256, random() * 256, 10 + random() * 40, 6 + random() * 20, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, random, 256, 4000, ["#7e4a2c", "#b4744a", "#8d5535", "#c2865c", "#6b3f25"], 2.2);
});

/** Ground: patchy grass over laterite. */
export const groundTexture = () => noiseTexture(256, "ground", (ctx, random) => {
  ctx.fillStyle = "#6f7d3f";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = random() < 0.45 ? "rgba(150,95,55,0.35)" : random() < 0.5 ? "rgba(70,100,45,0.4)" : "rgba(130,140,70,0.3)";
    ctx.beginPath();
    ctx.ellipse(random() * 256, random() * 256, 10 + random() * 50, 10 + random() * 40, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, random, 256, 3000, ["#5c6b33", "#83904c", "#8a6040", "#4f5e2c"], 1.8);
});

/** Roughness map for wet tarmac: dark blobs are puddles (smooth, mirror-like), the rest is damp. */
export const puddleTexture = () => noiseTexture(256, "puddles", (ctx, random) => {
  ctx.fillStyle = "#b0b0b0";
  ctx.fillRect(0, 0, 256, 256);
  ctx.filter = "blur(6px)";
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(10,10,10,${0.5 + random() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(random() * 256, random() * 256, 8 + random() * 30, 5 + random() * 16, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
});

/** Corrugated iron roofing sheets, the classic Lagos zinc roof (tinted per house). */
export const zincTexture = () => noiseTexture(256, "zinc", (ctx, random) => {
  for (let x = 0; x < 256; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, "#8e8e8e"); g.addColorStop(0.5, "#f2f2f2"); g.addColorStop(1, "#8e8e8e");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 8, 256);
  }
  for (let i = 0; i < 30; i++) { // rust streaks
    ctx.fillStyle = `rgba(120,60,25,${0.15 + random() * 0.25})`;
    ctx.fillRect(random() * 256, random() * 256, 3 + random() * 10, 20 + random() * 80);
  }
});
