import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const ALGORITHM_OPTIONS = [
  {
    id: "dijkstra",
    title: "Dijkstra",
    caption: "Classic single-source shortest paths on your road graph — EMS reliability baseline.",
  },
  {
    id: "astar",
    title: "A* (geometric heuristic)",
    caption: "Expands fewer nodes by biasing toward the destination — fast replanning cadence.",
  },
  {
    id: "bd_dijkstra",
    title: "Bidirectional Dijkstra",
    caption: "Searches simultaneously from EMS unit and ER — symmetrical wavefront convergence.",
  },
  {
    id: "ksp",
    title: "K-shortest paths (Yen)",
    caption: "Generates backups when arterials choke — contingency routing for supervisors.",
  },
];

const AVG_AMBULANCE_KMH = 48;
const SPEED_MS = (AVG_AMBULANCE_KMH * 1000) / 3600;

const K_COLORS = ["#33f0ff", "#ffb347", "#aa88ff", "#7cffb3", "#ff6688", "#f5f07a"];

function etaMinutes(distanceMeters) {
  if (distanceMeters == null || Number.isNaN(distanceMeters)) return null;
  return distanceMeters / SPEED_MS / 60;
}

function formatEta(minutes) {
  if (minutes == null) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  return `${minutes.toFixed(1)} min`;
}

function markerIcon(kind) {
  let color = "#33f0ff";
  let glyph = "";
  if (kind === "hospital") {
    color = "#7cf8ff";
    glyph = "+";
  } else if (kind === "ambulance_base") {
    color = "#9da7ff";
    glyph = "▸";
  } else if (kind === "incident") {
    color = "#ff6767";
    glyph = "!";
  }
  return L.divIcon({
    className: "ems-marker",
    html: `<div style="
        width:32px;height:32px;border-radius:10px;display:grid;
        place-items:center;font-weight:800;color:#081018;
        background: radial-gradient(circle at 35% 20%, rgba(255,255,255,0.92), transparent 62%), ${color};
        box-shadow: 0 0 0 1px rgba(255,255,255,0.28), 0 10px 26px rgba(0,0,0,0.55);
      ">${glyph}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28],
  });
}

export default function App() {
  const mapRef = useRef(null);
  const mapDomRef = useRef(null);
  const facilitiesLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const [facilities, setFacilities] = useState([]);
  const [loadingF, setLoadingF] = useState(true);
  const [fetchErr, setFetchErr] = useState(null);

  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [algo, setAlgo] = useState("dijkstra");
  const [busy, setBusy] = useState(false);
  const [routePayload, setRoutePayload] = useState(null);
  const [routeErr, setRouteErr] = useState(null);
  const [severity, setSeverity] = useState("Normal");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    fetch("/api/facilities")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((data) => setFacilities(data))
      .catch((e) => setFetchErr(e.message))
      .finally(() => setLoadingF(false));
  }, []);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch("/api/incident", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: latitude, lng: longitude, severity }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          
          setFacilities((prev) => [...prev, data.incident]);
          setOriginId(String(data.incident.id));
          
          if (data.suggestions?.hospital) {
            setDestinationId(String(data.suggestions.hospital.id));
          }
          if (data.suggestions?.ems) {
            // we could suggest EMS, but our UI maps origin->destination
            // We'll just alert for EMS suggestion
            alert(`Incident created! Nearest EMS base: ${data.suggestions.ems.name}. Nearest Hospital auto-selected.`);
          }
        } catch (err) {
          alert("Error creating incident: " + err.message);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        alert("Error getting location: " + err.message);
        setLocating(false);
      }
    );
  };

  const resetRouteOverlay = () => {
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
  };

  const drawRouteResult = useCallback((payload, selectedAlgorithm) => {
    if (!mapRef.current || !payload) return;
    resetRouteOverlay();
    const group = L.layerGroup();
    routeLayerRef.current = group;

    const addGeom = (geojson, opts) => {
      if (!geojson) return;
      const layer = L.geoJSON(geojson, {
        style: {
          weight: opts.weight ?? 4,
          color: opts.color ?? "#33f0ff",
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          dashArray: opts.dashArray ?? null,
        },
      });
      group.addLayer(layer);
    };

    if (selectedAlgorithm === "ksp" && payload.paths?.length) {
      payload.paths.forEach((p, idx) =>
        addGeom(p.geojson, {
          color: K_COLORS[idx % K_COLORS.length],
          weight: idx === 0 ? 6 : 3,
          dashArray: idx === 0 ? null : idx % 2 ? "12 8" : "4 14",
        })
      );
    } else if (payload.route?.geojson) {
      addGeom(payload.route.geojson, { weight: 5, color: "#e7fbff", dashArray: null });
      addGeom(payload.route.geojson, { weight: 2, color: "#33f0ff", dashArray: null });
    }

    group.addTo(mapRef.current);
    try {
      const bounds = group.getBounds();
      if (bounds?.isValid()) {
        mapRef.current.fitBounds(bounds.pad(0.18));
      }
    } catch (_e) {
      /* noop */
    }
  }, []);

  useEffect(() => {
    const el = mapDomRef.current;
    if (!el || mapRef.current) return undefined;

    const map = L.map(el, {
      zoomControl: true,
      scrollWheelZoom: true,
      preferCanvas: true,
    }).setView([18.98, 72.865], 10);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);

    facilitiesLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      resetRouteOverlay();
      map.off();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!facilitiesLayerRef.current || !mapRef.current) return undefined;
    const layerGroup = facilitiesLayerRef.current;
    layerGroup.clearLayers();
    facilities.forEach((f) => {
      const m = L.marker([f.lat, f.lng], { icon: markerIcon(f.kind) });
      const role =
        f.kind === "hospital" ? "Hospital" : f.kind === "ambulance_base" ? "EMS base" : "Incident scene";
      m.bindPopup(`${f.name}<br/><span class="muted">${role} · nearest node ${f.nearest_node}</span>`);
      layerGroup.addLayer(m);
    });
    return undefined;
  }, [facilities]);

  const runRoute = async () => {
    setRouteErr(null);
    setRoutePayload(null);
    resetRouteOverlay();
    if (!originId || !destinationId) {
      setRouteErr("Pick an origin facility and an ER / destination.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          algorithm: algo,
          originId: Number(originId),
          destinationId: Number(destinationId),
          k: 4,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? res.statusText);
      }
      setRoutePayload(body);
      drawRouteResult(body, algo);
    } catch (err) {
      setRouteErr(err.message);
    } finally {
      setBusy(false);
    }
  };

  const groupedFacilities = useMemo(() => {
    const buckets = {
      ambulance_base: [],
      incident: [],
      hospital: [],
    };
    facilities.forEach((f) => {
      buckets[f.kind]?.push(f);
    });
    return buckets;
  }, [facilities]);

  const etaSummary = useMemo(() => {
    if (!routePayload) return null;
    if (routePayload.route) {
      const m = routePayload.route.totalCostMeters;
      return { rows: [{ label: routePayload.label, meters: m, eta: etaMinutes(m) }] };
    }
    if (routePayload.paths?.length) {
      const rows = routePayload.paths.map((p, idx) => ({
        label: `Path ${idx + 1}`,
        meters: p.totalCostMeters,
        eta: etaMinutes(p.totalCostMeters),
      }));
      return { rows };
    }
    return null;
  }, [routePayload]);

  return (
    <div className="shell">
      <aside aria-label="Routing controls">
        <div className="glass-panel hero">
          <h1>Pulse Dispatch Graph</h1>
          <p>
            Tactical routing cockpit over a pgRouting-backed grid. Tune algorithmic behavior, visualize wavefront growth,
            and compare contingency paths designed for EMS dispatch coursework.
          </p>
          <span className="pill-strip" aria-hidden />
        </div>
        <div className="pill-strip">
          <span className="pulse-dot" />
          <small className="mini-hint">Live demo graph · seeded OSM-aligned bounds · algorithms from pgRouting extension</small>
        </div>

        {fetchErr ? (
          <div className="glass-panel stats-strip">
            <p className="error-box">
              <strong>Map data offline.</strong>
              {' '}
              {fetchErr}. Ensure Postgres/PostGIS/pgRouting running and npm run db:reload.
            </p>
          </div>
        ) : null}

        <div className="field">
          <div className="field-label">Origin dispatch</div>
          <select
            value={originId}
            disabled={loadingF}
            className="select-like"
            onChange={(e) => setOriginId(e.target.value)}
          >
            <option value="">Select EMS base or incident pickup…</option>
            <optgroup label="Ambulance bases">
              {(groupedFacilities.ambulance_base ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Incidents">
              {(groupedFacilities.incident ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          </select>
          <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={severity}
              disabled={locating || loadingF}
              className="select-like"
              style={{ flex: 1, padding: "8px" }}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="Normal">Normal</option>
              <option value="Serious">Serious</option>
              <option value="Fatal">Fatal</option>
            </select>
            <button
              type="button"
              className="run-btn"
              style={{ flex: 1, padding: "8px" }}
              onClick={useCurrentLocation}
              disabled={locating || loadingF}
            >
              {locating ? "Locating…" : "Use My Location"}
            </button>
          </div>
        </div>

        <div className="field">
          <div className="field-label">Destination ER</div>
          <select
            value={destinationId}
            disabled={loadingF}
            className="select-like"
            onChange={(e) => setDestinationId(e.target.value)}
          >
            <option value="">Select receiving hospital…</option>
            <optgroup label="Hospitals">
              {(groupedFacilities.hospital ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          </select>
          <small className="mini-hint" style={{ marginTop: "8px", display: "inline-block" }}>
            Markers show facility metadata; routing uses select boxes so graph nodes stay deterministic.
          </small>
        </div>

        <fieldset className="field" aria-label="Algorithm selection" style={{ border: "none", padding: 0 }}>
          <div className="field-label">
            Algorithms <span className="ksep">· pgRouting kernels</span>
          </div>
          <div className="algo-stack">
            {ALGORITHM_OPTIONS.map((opt) => (
              <label key={opt.id} className="algo-choice" aria-checked={algo === opt.id}>
                <input
                  className="algo-radio"
                  type="radio"
                  name="algorithm"
                  value={opt.id}
                  checked={algo === opt.id}
                  onChange={() => setAlgo(opt.id)}
                />
                <div>
                  <strong>{opt.title}</strong>
                  <span>{opt.caption}</span>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="run-bar">
          <button type="button" className="run-btn" onClick={() => runRoute()} disabled={busy || loadingF}>
            {busy ? "Routing…" : "Execute route"}
          </button>
        </div>

        {routeErr ? (
          <div className="field">
            <p className="error-box">{routeErr}</p>
          </div>
        ) : null}

        {routePayload ? (
          <section className="glass-panel stats-strip" aria-live="polite">
            <div className="stat-row">
              <span>Computation</span>
              <span className="stat-val">{routePayload.computeMs} ms</span>
            </div>
            {algo !== "ksp" &&
              etaSummary?.rows.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    marginTop: "0.5rem",
                    paddingBottom: "0.4rem",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="stat-row">
                    <span>
                      Route length
                      <span className="ksep"> · {routePayload.label}</span>
                    </span>
                    <span className="stat-val">{row.meters != null ? `${row.meters.toFixed(0)} m` : "—"}</span>
                  </div>
                  <div className="stat-row" style={{ marginTop: "0.35rem" }}>
                    <span>
                      ETA @ {AVG_AMBULANCE_KMH} km/h
                      <span className="ksep"> · simplified drive model</span>
                    </span>
                    <span className="stat-val">{formatEta(row.eta)}</span>
                  </div>
                </div>
              ))}
            {algo === "ksp" && routePayload.paths?.length ? (
              <table className="ksp-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Cost (m)</th>
                    <th>ETA</th>
                  </tr>
                </thead>
                <tbody>
                  {routePayload.paths.map((p, idx) => (
                    <tr key={p.pathId}>
                      <td>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            marginRight: 8,
                            background: K_COLORS[idx % K_COLORS.length],
                          }}
                        />
                        #{idx + 1}
                      </td>
                      <td>{p.totalCostMeters?.toFixed(0) ?? "—"}</td>
                      <td>{formatEta(etaMinutes(p.totalCostMeters))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}
      </aside>

      <section className="map-wrap" aria-label="Map">
        <div ref={mapDomRef} className="leaf-box" />
        <div className="overlay-badge">
          <div className="badge-chip glass-panel">
            Dark basemap · projected costs in meters (UTM 43N)
          </div>
        </div>
        {algo === "ksp" && routePayload?.paths?.length ? (
          <div className="ksp-legend">
            <div className="ksp-legend-inner glass-panel">
              <strong style={{ fontFamily: "Outfit, sans-serif" }}>K-path key</strong>
              <div>
                Thickest stroke = shortest cost path; dashed tiers are alternates suitable for blockage reroutes.
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
