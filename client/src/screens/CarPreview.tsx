import { Canvas } from "@react-three/fiber";
import type { CarSpec } from "../../../shared/cars.js";
import { CarTurntable } from "../world/CarModel";
import { Environment } from "../world/look";

/** Showroom turntable behind the garage menus (lazy-loaded, so the garage opens before three.js does). */
export default function CarPreview({ car, night }: { car: CarSpec; night: boolean }) {
  const d = Math.max(5.6, car.length * 1.3);
  return <div className="garage-stage">
    <Canvas shadows camera={{ fov: 30, position: [d * 1.05, d * 0.3, d * 0.95] }} onCreated={({ camera }) => camera.lookAt(0, 0.55, 0)} dpr={[1, 2]}>
      <color attach="background" args={[night ? "#07080c" : "#1a1f2b"]} />
      <Environment night={night} />
      <spotLight position={[0, 9, 0]} angle={0.55} penumbra={0.7} intensity={140} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-5, 1.4, -3]} intensity={30} color="#ff2e88" />
      <pointLight position={[5, 1.4, 3]} intensity={24} color="#19e3ff" />
      <CarTurntable spec={car} />
    </Canvas>
  </div>;
}
