-- Road network for pgRouting (projected meters: WGS84 -> UTM 43N, Mumbai region)
DROP TABLE IF EXISTS ways CASCADE;

CREATE TABLE ways (
  gid SERIAL PRIMARY KEY,
  name TEXT,
  source BIGINT,
  target BIGINT,
  cost DOUBLE PRECISION,
  reverse_cost DOUBLE PRECISION,
  geom geometry(LineString, 32643) NOT NULL
);

CREATE INDEX ways_geom_idx ON ways USING GIST (geom);
CREATE INDEX ways_source_idx ON ways (source);
CREATE INDEX ways_target_idx ON ways (target);

DROP TABLE IF EXISTS routing_nodes CASCADE;

CREATE TABLE routing_nodes (
  id BIGSERIAL PRIMARY KEY,
  geom geometry(Point, 32643) NOT NULL
);

CREATE UNIQUE INDEX routing_nodes_geom_uq ON routing_nodes (geom);

-- EMS points of interest (stored in WGS84 for map display; nearest graph node resolved in app / seed)
DROP TABLE IF EXISTS ems_facilities CASCADE;

CREATE TABLE ems_facilities (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hospital', 'ambulance_base', 'incident')),
  name TEXT NOT NULL,
  nearest_node BIGINT,
  geom geography(Point, 4326) NOT NULL
);

CREATE INDEX ems_facilities_geom_idx ON ems_facilities USING GIST (geom);
