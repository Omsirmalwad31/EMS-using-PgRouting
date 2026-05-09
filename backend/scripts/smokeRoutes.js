import "dotenv/config";
import { pool } from "../db.js";
import { algorithms } from "../pgroutingService.js";

const origin = Number(process.argv[2] ?? 5);
const dest = Number(process.argv[3] ?? 2);

async function smoke() {
  const { rows } = await pool.query(
    `SELECT id, nearest_node FROM ems_facilities WHERE id IN ($1,$2)`,
    [origin, dest]
  );
  if (rows.length !== 2) {
    console.error("Need two distinct facility IDs from ems_facilities.");
    process.exit(1);
  }
  const a = rows.find((r) => Number(r.id) === origin)?.nearest_node;
  const b = rows.find((r) => Number(r.id) === dest)?.nearest_node;

  console.log({ originFacility: origin, destFacility: dest, nodes: [a, b] });

  for (const key of ["dijkstra", "astar", "bd_dijkstra"]) {
    const res = await algorithms[key].run(pool, a, b);
    console.log(key, Boolean(res.geojson), res.totalCostMeters?.toFixed(1));
  }
  const ksp = await algorithms.ksp.run(pool, a, b, 3);
  console.log("ksp", ksp.map((p) => p.totalCostMeters?.toFixed(1)));
  await pool.end();
}

await smoke();
