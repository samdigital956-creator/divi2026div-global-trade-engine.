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
