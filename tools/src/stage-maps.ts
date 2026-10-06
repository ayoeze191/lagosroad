import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "tools/data");
const targets = [resolve(root, "client/public/maps"), resolve(root, "server/maps")];

/** Copy every generated LCDA map to where the client and the race server load them. */
export async function stageMaps() {
  const files = (await readdir(source)).filter((file) => file.endsWith(".json"));
  if (!files.length) throw new Error("No generated maps found. Run `npm run map:build -- <lcda>` first.");
  for (const directory of targets) {
    await mkdir(directory, { recursive: true });
    await Promise.all((await readdir(directory)).filter((file) => file.endsWith(".json")).map((file) => rm(resolve(directory, file))));
  }
  const maps: { slug: string; name: string }[] = [];
  for (const file of files) {
    const data = JSON.parse(await readFile(resolve(source, file), "utf8")) as { area: { slug: string; name: string } };
    maps.push({ slug: data.area.slug, name: data.area.name });
    await Promise.all(targets.map((directory) => cp(resolve(source, file), resolve(directory, file))));
  }
  await writeFile(resolve(targets[0], "index.json"), JSON.stringify(maps, null, 2) + "\n");
  console.log(`Staged ${maps.length} LCDA map${maps.length === 1 ? "" : "s"} for client and server: ${maps.map((map) => map.slug).join(", ")}`);
}

if (process.argv[1]?.endsWith("stage-maps.ts")) stageMaps().catch((error) => { console.error(error); process.exitCode = 1; });
