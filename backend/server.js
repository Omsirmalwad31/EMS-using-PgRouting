import cors from "cors";
import express from "express";
import { pool } from "./db.js";
import { algorithms } from "./pgroutingService.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: true });
  } catch (err) {
    res.status(500).json({ ok: false, database: false, message: err.message });
  }
});

app.get("/api/facilities", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id,
        kind,
        name,
        nearest_node,
        ST_X(geom::geometry) AS lng,
        ST_Y(geom::geometry) AS lat
      FROM ems_facilities
      ORDER BY kind, id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/algorithms", (_req, res) => {
  res.json(
    Object.entries(algorithms).map(([key, v]) => ({
      id: key,
      label: v.label,
    }))
  );
});

app.post("/api/route", async (req, res) => {
  const algorithm = req.body?.algorithm;
  const originId = Number(req.body?.originId);
  const destinationId = Number(req.body?.destinationId);
  const k = Math.min(8, Math.max(2, Number(req.body?.k ?? 4)));

  if (!algorithms[algorithm]) {
    return res.status(400).json({ error: "Unknown algorithm" });
  }
  if (!Number.isFinite(originId) || !Number.isFinite(destinationId)) {
    return res.status(400).json({ error: "originId and destinationId are required" });
  }

  try {
    const nodes = await pool.query(
      `SELECT id, nearest_node FROM ems_facilities WHERE id = ANY($1::int[])`,
      [[originId, destinationId]]
    );
    const byId = new Map(nodes.rows.map((r) => [r.id, r.nearest_node]));
    const start = byId.get(originId);
    const end = byId.get(destinationId);
    if (start == null || end == null) {
      return res.status(404).json({ error: "Facility not found" });
    }
    if (start === end) {
      return res.status(400).json({ error: "Origin and destination map to the same network node" });
    }

    const started = performance.now();
    const spec = algorithms[algorithm];
    let payload;

    if (algorithm === "ksp") {
      const paths = await spec.run(pool, start, end, k);
      payload = {
        algorithm,
        label: spec.label,
        computeMs: Math.round(performance.now() - started),
        paths,
      };
    } else {
      const route = await spec.run(pool, start, end);
      payload = {
        algorithm,
        label: spec.label,
        computeMs: Math.round(performance.now() - started),
        route,
      };
    }

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/incident", async (req, res) => {
  const { lat, lng, severity } = req.body;
  if (!lat || !lng || !severity) return res.status(400).json({ error: "Missing lat, lng, or severity" });

  try {
    const nodeRes = await pool.query(`
      SELECT id FROM routing_nodes 
      ORDER BY ST_Distance(geom, ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geometry, 32643)) 
      LIMIT 1
    `, [lng, lat]);
    const nearestNode = nodeRes.rows[0]?.id;

    const insertRes = await pool.query(`
      INSERT INTO ems_facilities (kind, name, nearest_node, geom)
      VALUES ('incident', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
      RETURNING id, name, kind, nearest_node, ST_X(geom::geometry) AS lng, ST_Y(geom::geometry) AS lat
    `, [`User Location (${severity})`, nearestNode, lng, lat]);
    const newIncident = insertRes.rows[0];

    const suggestionsRes = await pool.query(`
      (SELECT id, name, kind, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist
       FROM ems_facilities WHERE kind = 'hospital' ORDER BY dist ASC LIMIT 1)
      UNION ALL
      (SELECT id, name, kind, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist
       FROM ems_facilities WHERE kind = 'ambulance_base' ORDER BY dist ASC LIMIT 1)
    `, [lng, lat]);

    const nearestHospital = suggestionsRes.rows.find(r => r.kind === 'hospital');
    const nearestEms = suggestionsRes.rows.find(r => r.kind === 'ambulance_base');

    res.json({
      incident: newIncident,
      suggestions: {
        hospital: nearestHospital,
        ems: nearestEms
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`EMS routing API on http://localhost:${port}`);
});
