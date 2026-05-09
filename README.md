# Metro EMS Routing Lab

Full-stack EMS dispatch laboratory that routes synthetic urban corridors with **PostgreSQL**, **PostGIS**, and **pgRouting**. Four selectable algorithms (**Dijkstra**, **`A*`**, **bidirectional Dijkstra**, **K shortest paths**) share the same edge table; a React + Leaflet console visualizes routes on a dark basemap.

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ with **PostGIS** and **pgRouting** enabled (superuser or `CREATE` on the target database for extensions)

## Database setup

1. Create a database (pick one name and keep it aligned with `DB_DATABASE`):

   ```sql
   CREATE DATABASE ems_pgrouting;
   ```

2. Copy `backend/.env.example` to `backend/.env` and set credentials. You can also place `.env` at the repository root; the API loads both locations.

3. Install backend dependencies and seed the road graph:

   ```bash
   cd backend
   npm install
   npm run db:reload
   ```

   The script runs `sql/01_init_extensions.sql`, `sql/02_schema.sql`, and `sql/03_seed_network.sql`.

## Run the stack

```bash
# Terminal A — API
cd backend
npm run dev

# Terminal B — UI (proxies /api → :4000)
cd frontend
npm install
npm run dev
```

Open the UI at `http://localhost:5173`. Choose an EMS base or incident as the origin, a hospital as the destination, select an algorithm, then **Execute route**.

## Project map

- `sql/` — extensions, `ways` edge table, synthetic Mumbai-bounds grid, facilities, topology.
- `backend/server.js` — REST endpoints (`/api/facilities`, `/api/route`, `/api/algorithms`).
- `backend/pgroutingService.js` — pgRouting function wrappers returning GeoJSON for the UI.
- `frontend/src/App.jsx` — glassmorphism layout, Leaflet visualization, ETA estimate from a nominal ambulance cruise speed constant.

Road costs are geometric lengths **in meters** on **EPSG:32643**, which keeps heuristic A* coherent with driving-distance weights.

If your pgRouting build omits `pgr_createTopology`, the seed script still works: it materializes junctions in `routing_nodes` and wires `ways.source` / `ways.target` with snapped endpoints. The same graph powers all four SQL functions.
