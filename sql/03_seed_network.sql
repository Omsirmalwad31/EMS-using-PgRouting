-- Synthetic grid + diagonals over Mumbai-ish bounds (good for coursework demos)
TRUNCATE ways RESTART IDENTITY CASCADE;

-- Horizontal segments
INSERT INTO ways (name, geom)
SELECT
  format('H_%s_%s', i, j),
  ST_Transform(
    ST_MakeLine(
      ST_SetSRID(ST_MakePoint(72.83 + i * 0.012, 18.95 + j * 0.015), 4326),
      ST_SetSRID(ST_MakePoint(72.83 + (i + 1) * 0.012, 18.95 + j * 0.015), 4326)
    ),
    32643
  )
FROM generate_series(0, 7) AS i,
     generate_series(0, 8) AS j;

-- Vertical segments
INSERT INTO ways (name, geom)
SELECT
  format('V_%s_%s', i, j),
  ST_Transform(
    ST_MakeLine(
      ST_SetSRID(ST_MakePoint(72.83 + i * 0.012, 18.95 + j * 0.015), 4326),
      ST_SetSRID(ST_MakePoint(72.83 + i * 0.012, 18.95 + (j + 1) * 0.015), 4326)
    ),
    32643
  )
FROM generate_series(0, 8) AS i,
     generate_series(0, 7) AS j;

-- Sparse diagonals (two-way same cost)
INSERT INTO ways (name, geom)
SELECT
  format('D_%s_%s', i, j),
  ST_Transform(
    ST_MakeLine(
      ST_SetSRID(ST_MakePoint(72.83 + i * 0.012, 18.95 + j * 0.015), 4326),
      ST_SetSRID(ST_MakePoint(72.83 + (i + 1) * 0.012, 18.95 + (j + 1) * 0.015), 4326)
    ),
    32643
  )
FROM generate_series(0, 6) AS i,
     generate_series(0, 6) AS j
WHERE (i + j) % 2 = 0;

-- Costs: length in meters; two-way streets
UPDATE ways
SET
  cost = GREATEST(ST_Length(geom), 0.01),
  reverse_cost = GREATEST(ST_Length(geom), 0.01);

-- Manual node graph (works when pgr_createTopology is unavailable in minimal stacks)
TRUNCATE routing_nodes RESTART IDENTITY CASCADE;

INSERT INTO routing_nodes (geom)
SELECT DISTINCT g
FROM (
  SELECT ST_SnapToGrid(ST_StartPoint(geom), 0.05) AS g FROM ways
  UNION ALL
  SELECT ST_SnapToGrid(ST_EndPoint(geom), 0.05) FROM ways
) q
WHERE g IS NOT NULL;

UPDATE ways AS w
SET
  source = ns.id,
  target = nt.id
FROM routing_nodes AS ns,
     routing_nodes AS nt
WHERE ST_DWithin(ST_SnapToGrid(ST_StartPoint(w.geom), 0.05), ns.geom, 0.05)
  AND ST_DWithin(ST_SnapToGrid(ST_EndPoint(w.geom), 0.05), nt.geom, 0.05);

UPDATE ways SET reverse_cost = cost WHERE reverse_cost IS NULL OR reverse_cost <= 0;

TRUNCATE ems_facilities RESTART IDENTITY CASCADE;

INSERT INTO ems_facilities (kind, name, geom) VALUES
  ('hospital', 'City Trauma Centre', ST_SetSRID(ST_MakePoint(72.85, 19.06), 4326)::geography),
  ('hospital', 'Metro General ER', ST_SetSRID(ST_MakePoint(72.892, 19.02), 4326)::geography),
  ('ambulance_base', 'Northern Dispatch Hub', ST_SetSRID(ST_MakePoint(72.835, 19.065), 4326)::geography),
  ('ambulance_base', 'Southern Quick Response', ST_SetSRID(ST_MakePoint(72.888, 18.962), 4326)::geography),
  ('incident', 'Reported casualty – Link Road', ST_SetSRID(ST_MakePoint(72.865, 19.038), 4326)::geography),
  ('incident', 'Industrial zone alarm', ST_SetSRID(ST_MakePoint(72.822, 18.978), 4326)::geography),
  ('incident', 'Coastal highway MVA', ST_SetSRID(ST_MakePoint(72.905, 19.048), 4326)::geography);

-- Snap each facility to closest routing vertex (in EPSG:32643 space)
WITH m AS (
  SELECT
    f.id AS fid,
    (
      SELECT rn.id
      FROM routing_nodes rn
      ORDER BY ST_Distance(rn.geom, ST_Transform(f.geom::geometry, 32643))
      LIMIT 1
    ) AS nid
  FROM ems_facilities f
)
UPDATE ems_facilities f
SET nearest_node = m.nid
FROM m
WHERE f.id = m.fid;
