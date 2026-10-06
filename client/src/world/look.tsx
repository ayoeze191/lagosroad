import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/**
 * The "Need for Speed" look: filmic tone mapping, reflections from an environment map, a sky dome,
 * glow (bloom) on lights, and a night mode where windows, streetlights and signs light up.
 * Every world shader reads `NIGHT` (0 = day, 1 = night), so switching is one uniform.
 */
export const NIGHT = { value: 1 };

/** Phones and small GPUs skip bloom and shadows (they still get the materials, lights and sky). */
export const HIGH_QUALITY = typeof window !== "undefined" && !matchMedia("(pointer: coarse)").matches && (navigator.hardwareConcurrency || 4) >= 4;

export const PALETTE = {
  night: { zenith: "#02030a", horizon: "#1a1438", glow: "#7a3cff", fog: "#0e0b1e", hemiSky: "#34417a", hemiGround: "#06060c", hemi: 0.32, sun: "#8fa8ff", sunI: 0.35, env: 0.16, exposure: 0.95 },
  day: { zenith: "#3f7cc4", horizon: "#d4e2ea", glow: "#ffe2b0", fog: "#c9d8e2", hemiSky: "#fff6e0", hemiGround: "#6d6a4a", hemi: 1.3, sun: "#fff1d6", sunI: 2.4, env: 0.7, exposure: 1.0 }
};
export const palette = (night: boolean) => (night ? PALETTE.night : PALETTE.day);

/** Tone mapping + a reflection environment so paint, glass and wet roads shine. */
export function Environment({ night }: { night: boolean }) {
  const { gl, scene } = useThree();
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => {
    const p = palette(night);
    NIGHT.value = night ? 1 : 0;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = p.exposure;
    scene.environment = env;
    scene.environmentIntensity = p.env;
    return () => { scene.environment = null; };
  }, [gl, scene, env, night]);
  useEffect(() => () => env.dispose(), [env]);
  return null;
}

const skyVertex = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always on the far plane
}`;
const skyFragment = /* glsl */`
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform float night;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  float h = max(vDir.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(h, 0.55));
  col += glow * pow(1.0 - h, 12.0) * (night > 0.5 ? 0.22 : 0.25); // city glow / haze on the horizon
  if (night > 0.5) {
    vec3 cell = floor(vDir * 260.0);
    float star = step(0.9965, hash(cell)) * smoothstep(0.08, 0.4, h);
    col += vec3(star * (0.6 + 0.4 * hash(cell + 1.0)));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Gradient sky dome with a horizon glow (and stars at night). Follows the camera. */
export function Sky({ night }: { night: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, night: { value: 1 } }
  }), []);
  useEffect(() => {
    const p = palette(night);
    material.uniforms.zenith.value.set(p.zenith);
    material.uniforms.horizon.value.set(p.horizon);
    material.uniforms.glow.value.set(p.glow);
    material.uniforms.night.value = night ? 1 : 0;
  }, [material, night]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => mesh.current?.position.copy(camera.position));
  return <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
    <sphereGeometry args={[300, 32, 16]} />
  </mesh>;
}

/** Sun or moon (with shadows that follow the camera on capable devices), sky light and fog. */
export function Lighting({ night, fogNear = 140, fogFar = 400 }: { night: boolean; fogNear?: number; fogFar?: number }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const p = palette(night);
  useEffect(() => {
    scene.fog = new THREE.Fog(p.fog, night ? fogNear * 0.6 : fogNear, night ? fogFar * 0.85 : fogFar);
    return () => { scene.fog = null; };
  }, [scene, night, p.fog, fogNear, fogFar]);
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    scene.add(light.target);
    const cam = light.shadow.camera;
    cam.left = cam.bottom = -70; cam.right = cam.top = 70; cam.near = 1; cam.far = 260;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.04;
    return () => { scene.remove(light.target); };
  }, [scene]);
  useFrame(({ camera }) => {
    const light = sun.current;
    if (!light) return;
    // Keep the shadow box centred a little ahead of the camera, snapped to texels to avoid shimmer.
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const cx = Math.round(camera.position.x + dir.x * 40), cz = Math.round(camera.position.z + dir.z * 40);
    light.target.position.set(cx, 0, cz);
    light.position.set(cx + (night ? -60 : 70), 120, cz + (night ? 40 : 50));
  });
  return <>
    <color attach="background" args={[p.horizon]} />
    <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemi]} />
    <directionalLight ref={sun} color={p.sun} intensity={p.sunI} castShadow={HIGH_QUALITY} shadow-mapSize={[2048, 2048]} />
  </>;
}

/** Bloom post-processing: takes over rendering (priority 1) so bright lights glow. */
export function Bloom({ strength = 0.85 }: { strength?: number }) {
  const { gl, scene, camera, size, viewport } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), strength, 0.4, 0.92));
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera, strength]);
  useEffect(() => {
    composer.setPixelRatio(viewport.dpr);
    composer.setSize(size.width, size.height);
  }, [composer, size, viewport.dpr]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame((_, dt) => composer.render(dt), 1);
  return null;
}

/** Soft radial spot used for streetlight pools and headlight glow (additive). */
let glowTexture: THREE.Texture | undefined;
export function glow() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}
