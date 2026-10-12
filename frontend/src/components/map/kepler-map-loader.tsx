"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

// kepler.gl touches window/WebGL at import time, so it must never render on the server.
// The basemap check runs alongside the import, so the map's store knows which tiles it has.
const loadKeplerMap = () =>
  Promise.all([import("./kepler-map"), import("./basemaps").then((m) => m.loadBasemaps())]).then(([mod]) => mod);

const KeplerMap = dynamic(loadKeplerMap, {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-muted/40">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading map…
      </div>
    </div>
  ),
});

export function KeplerMapLoader() {
  return <KeplerMap />;
}
