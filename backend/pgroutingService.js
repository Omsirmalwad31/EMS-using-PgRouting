const edgeSql = `
  SELECT gid AS id, source, target, cost, reverse_cost,
         ST_X(ST_StartPoint(geom)) AS x1,
         ST_Y(ST_StartPoint(geom)) AS y1,
         ST_X(ST_EndPoint(geom)) AS x2,
         ST_Y(ST_EndPoint(geom)) AS y2
  FROM ways
  WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0
`;

const edgeSqlSimple = `
  SELECT gid AS id, source, target, cost, reverse_cost
  FROM ways
  WHERE source IS NOT NULL AND target IS NOT NULL AND cost > 0
`;

const stepsAgg = `
  SELECT json_agg(json_build_object(
    'seq', r.path_seq,
    'node', r.node,
    'edge', r.edge,
    'cost', r.cost,
    'aggCost', r.agg_cost
  ) ORDER BY r.path_seq) FROM r`;

async function singlePathFixed(pool, routingCteInner, params) {
  const rows = await pool.query(
    `
    WITH r AS (
      ${routingCteInner}
    ),
    line AS (
      SELECT ST_LineMerge(ST_Collect(w.geom ORDER BY r.path_seq)) AS merged
      FROM r
      LEFT JOIN ways w ON w.gid = r.edge AND r.edge > 0
    )
    SELECT
      ST_AsGeoJSON(ST_Transform(line.merged, 4326)) AS geojson,
      (SELECT MAX(r2.agg_cost) FROM r r2)::float8 AS total_cost,
      (${stepsAgg}) AS steps
    FROM line
    WHERE line.merged IS NOT NULL
    `,
    params
  );

  const row = rows.rows[0];
  if (!row?.geojson) {
    return { pathId: 0, geojson: null, totalCostMeters: null, steps: [] };
  }
  return {
    pathId: 0,
    geojson: JSON.parse(row.geojson),
    totalCostMeters: row.total_cost,
    steps: row.steps ?? [],
  };
}

export async function runDijkstra(pool, startNode, endNode) {
  return singlePathFixed(
    pool,
    `
      SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
      FROM pgr_dijkstra(
        $sql$${edgeSqlSimple}$sql$,
        $1::bigint,
        $2::bigint,
        directed := false
      )
    `,
    [startNode, endNode]
  );
}

export async function runAStar(pool, startNode, endNode) {
  return singlePathFixed(
    pool,
    `
      SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
      FROM pgr_astar(
        $sql$${edgeSql}$sql$,
        $1::bigint,
        $2::bigint,
        false,
        5,
        1::float8,
        1::float8
      )
    `,
    [startNode, endNode]
  );
}

export async function runBdDijkstra(pool, startNode, endNode) {
  return singlePathFixed(
    pool,
    `
      SELECT seq, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
      FROM pgr_bdDijkstra(
        $sql$${edgeSqlSimple}$sql$,
        $1::bigint,
        $2::bigint,
        directed := false
      )
    `,
    [startNode, endNode]
  );
}

export async function runKsp(pool, startNode, endNode, k = 4) {
  const rows = await pool.query(
    `
    WITH r AS (
      SELECT seq, path_id, path_seq, start_vid, end_vid, node, edge, cost, agg_cost
      FROM pgr_ksp(
        $sql$${edgeSqlSimple}$sql$,
        $1::bigint,
        $2::bigint,
        $3::int,
        directed := false,
        heap_paths := false
      )
    ),
    paths AS (
      SELECT
        r.path_id,
        ST_LineMerge(ST_Collect(w.geom ORDER BY r.path_seq)) AS merged,
        MAX(r.agg_cost) AS total_cost,
        json_agg(json_build_object(
          'seq', r.path_seq,
          'node', r.node,
          'edge', r.edge,
          'cost', r.cost,
          'aggCost', r.agg_cost
        ) ORDER BY r.path_seq) AS steps
      FROM r
      LEFT JOIN ways w ON w.gid = r.edge AND r.edge > 0
      GROUP BY r.path_id
    )
    SELECT
      path_id,
      ST_AsGeoJSON(ST_Transform(merged, 4326)) AS geojson,
      total_cost::float8 AS total_cost,
      steps
    FROM paths
    WHERE merged IS NOT NULL
    ORDER BY path_id
    `,
    [startNode, endNode, k]
  );

  return rows.rows.map((row) => ({
    pathId: row.path_id,
    geojson: row.geojson ? JSON.parse(row.geojson) : null,
    totalCostMeters: row.total_cost,
    steps: row.steps ?? [],
  }));
}

export const algorithms = {
  dijkstra: { label: "Dijkstra", run: runDijkstra },
  astar: { label: "A*", run: runAStar },
  bd_dijkstra: { label: "Bidirectional Dijkstra", run: runBdDijkstra },
  ksp: { label: "K shortest paths (Yen)", run: runKsp },
};
