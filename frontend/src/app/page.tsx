import { KeplerMapLoader } from "@/components/map/kepler-map-loader";
import { TopBar } from "@/components/top-bar";

export default function Home() {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden">
      <TopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <KeplerMapLoader />
      </main>
    </div>
  );
}
