"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// OpenStreetMap's public tiles suit low traffic only; set NEXT_PUBLIC_MAP_TILE_URL for a commercial tile service.
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Last position reported by the provider plus its route line. Shows nothing the provider did not send. */
export function TrackingMap({ position, route, label }: { position: { lat: number; lng: number } | null; route: [number, number][]; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([position, route]);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { worldCopyJump: true, scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(TILE_URL, { maxZoom: 12, attribution: TILE_ATTRIBUTION }).addTo(map);
      const bounds: [number, number][] = [];
      if (route.length > 1) {
        L.polyline(route, { color: "#4f8cff", weight: 2, opacity: 0.8, dashArray: "4 6" }).addTo(map);
        bounds.push(...route);
      }
      if (position) {
        L.circleMarker([position.lat, position.lng], { radius: 7, color: "#e7ecf5", weight: 2, fillColor: "#4f8cff", fillOpacity: 1 })
          .bindTooltip(label)
          .addTo(map);
        bounds.push([position.lat, position.lng]);
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 6 });
      else if (bounds.length === 1) map.setView(bounds[0], 4);
      else map.setView([20, 0], 1);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, label]);

  return <div ref={el} className="tracking-map h-64 w-full overflow-hidden rounded-lg border border-line bg-bg" role="img" aria-label={`Map: ${label}`} />;
}

type FleetMarker = { id: string; lat: number; lng: number; label: string; delayed: boolean; href: string };

/** Every tracked box's last reported position. Clicking a marker opens its shipment. */
export function FleetMap({ markers }: { markers: FleetMarker[] }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(markers);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { worldCopyJump: true, scrollWheelZoom: false });
      L.tileLayer(TILE_URL, { maxZoom: 12, attribution: TILE_ATTRIBUTION }).addTo(map);
      for (const m of markers) {
        L.circleMarker([m.lat, m.lng], { radius: 6, color: "#e7ecf5", weight: 1.5, fillColor: m.delayed ? "#f2b84b" : "#4f8cff", fillOpacity: 1 })
          .bindTooltip(m.label)
          .on("click", () => window.location.assign(m.href))
          .addTo(map);
      }
      if (markers.length > 1) map.fitBounds(markers.map((m) => [m.lat, m.lng] as [number, number]), { padding: [32, 32], maxZoom: 5 });
      else if (markers.length === 1) map.setView([markers[0].lat, markers[0].lng], 4);
      else map.setView([20, 0], 1);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={el} className="tracking-map h-80 w-full overflow-hidden rounded-lg border border-line bg-bg" role="img" aria-label={`Map of ${markers.length} tracked containers`} />;
}
