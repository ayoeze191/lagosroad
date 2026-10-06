export type CarBody = "bus" | "sport" | "sedan" | "keke" | "bike" | "supercar" | "coupe" | "suv" | "limo" | "pickup";
export type CarClass = "classic" | "luxury";

export type CarSpec = {
  id: string;
  name: string;
  /** What it's modelled on, shown under the name. */
  inspired: string;
  tagline: string;
  class: CarClass;
  colour: string;
  /** Paint options offered in the garage (first is the default). */
  paints: string[];
  body: CarBody;
  /** Metres per second. */
  topSpeed: number;
  /** Metres per second squared at low speed. */
  acceleration: number;
  /** 1–10 */
  handling: number;
  /** 1–10: how much speed you keep when you hit a pothole. Low-slung supercars suffer. */
  potholeResistance: number;
  length: number;
  width: number;
  /** Multiplayer weapon this car can carry (the player chooses armed or not). */
  weapon?: "turret" | "conductor" | "escort";
};

// Luxury cars use lookalike names, not real brands (those are trademarks). Rename freely.
export const CARS: CarSpec[] = [
  { id: "danfo", name: "Danfo", inspired: "VW T3 Transporter (yellow danfo)", tagline: "Yellow bus. Eats potholes for breakfast.", class: "classic", colour: "#f5b700", paints: ["#f5b700"], body: "bus", topSpeed: 31, acceleration: 5.5, handling: 5, potholeResistance: 8, length: 4.8, width: 2.1, weapon: "conductor" },
  { id: "hilux", name: "Mile 12 Hilux", inspired: "Toyota Hilux pickup lookalike", tagline: "Roof turret in the back. Built for war on the road.", class: "classic", colour: "#e9e6df", paints: ["#e9e6df", "#1b1b1b", "#7a1f1f", "#56604a"], body: "pickup", topSpeed: 40, acceleration: 7.5, handling: 6, potholeResistance: 9, length: 5.3, width: 1.9, weapon: "turret" },
  { id: "runner", name: "Ikorodu Runner", inspired: "Toyota Camry tokunbo", tagline: "The all-rounder. Tokunbo but reliable.", class: "classic", colour: "#1f7ae0", paints: ["#1f7ae0", "#c9ccd1", "#2b2d31", "#7a1f2b"], body: "sedan", topSpeed: 38, acceleration: 7.5, handling: 8, potholeResistance: 6, length: 4.3, width: 1.8 },
  { id: "lekki", name: "Lekki GT", inspired: "VW Golf GTI", tagline: "Quick and light. Hates bad roads.", class: "classic", colour: "#e43d30", paints: ["#e43d30", "#f2f2f2", "#1b1b1b", "#00a37a"], body: "sport", topSpeed: 42, acceleration: 8.5, handling: 7, potholeResistance: 4, length: 4.2, width: 1.9 },
  { id: "keke", name: "Keke Turbo", inspired: "Bajaj RE keke", tagline: "Slow, nimble, fits through anything.", class: "classic", colour: "#2bb673", paints: ["#2bb673", "#f5b700"], body: "keke", topSpeed: 26, acceleration: 7, handling: 10, potholeResistance: 9, length: 2.8, width: 1.4 },
  { id: "okada", name: "Okada", inspired: "Bajaj Boxer okada", tagline: "Weaves through traffic. Barely feels potholes.", class: "classic", colour: "#d62828", paints: ["#d62828", "#1d3557", "#111111"], body: "bike", topSpeed: 33, acceleration: 9, handling: 10, potholeResistance: 7, length: 2.1, width: 0.8 },

  { id: "toro", name: "Toro V12", inspired: "Lamborghini Aventador lookalike", tagline: "Fastest thing in Ikorodu. Every pothole hurts.", class: "luxury", colour: "#c6e22a", paints: ["#c6e22a", "#f28c00", "#8a2be2", "#1b1b1b"], body: "supercar", topSpeed: 54, acceleration: 11, handling: 8, potholeResistance: 1, length: 4.6, width: 2.0 },
  { id: "rosso", name: "Rosso 812", inspired: "Ferrari 812 lookalike", tagline: "Screaming V12, sharp handling, fragile nose.", class: "luxury", colour: "#d40000", paints: ["#d40000", "#f7d100", "#f2f2f2", "#0d2a5c"], body: "coupe", topSpeed: 51, acceleration: 10.5, handling: 9, potholeResistance: 2, length: 4.6, width: 1.95 },
  { id: "stallion", name: "Stallion 911", inspired: "Porsche 911 lookalike", tagline: "Balanced and brutal off the line.", class: "luxury", colour: "#b8bcc2", paints: ["#b8bcc2", "#1b1b1b", "#2e6db4", "#e05a1b"], body: "coupe", topSpeed: 47, acceleration: 11, handling: 9, potholeResistance: 3, length: 4.4, width: 1.85 },
  { id: "gwagon", name: "Eko G-Wagon", inspired: "Mercedes G-Class lookalike", tagline: "Big-man ride. Potholes? What potholes?", class: "luxury", colour: "#15171a", paints: ["#15171a", "#f2f2f2", "#6b705c", "#5a0f1a"], body: "suv", topSpeed: 38, acceleration: 7, handling: 6, potholeResistance: 10, length: 4.7, width: 2.0, weapon: "escort" },
  { id: "phantom", name: "Ikoyi Phantom", inspired: "Rolls-Royce Phantom lookalike", tagline: "Floats over bad roads in total silence.", class: "luxury", colour: "#f2efe8", paints: ["#f2efe8", "#15171a", "#1c2c4c", "#6d1a2b"], body: "limo", topSpeed: 42, acceleration: 7.5, handling: 5, potholeResistance: 8, length: 5.6, width: 2.0 }
];

export const carById = (id: string | undefined) => CARS.find((car) => car.id === id) || CARS.find((car) => car.id === "runner")!;

/** A car with the player's chosen paint (falls back to the default if the colour isn't offered). */
export const withPaint = (car: CarSpec, colour?: string): CarSpec => (colour && car.paints.includes(colour) ? { ...car, colour } : car);

/** Police interceptor used by the chase AI: faster than every car in the garage, so you have to out-drive it, not out-run it. */
export const POLICE_CAR: CarSpec = { id: "police", name: "Police", inspired: "", tagline: "", class: "classic", colour: "#f4f4f4", paints: ["#f4f4f4"], body: "sedan", topSpeed: 58, acceleration: 14, handling: 9, potholeResistance: 9, length: 4.5, width: 1.85 };
