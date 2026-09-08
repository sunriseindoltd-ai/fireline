import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { gateLogout } from "@/lib/gate-actions";
import type { GateRole } from "@/lib/gate";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/kanopi/styles/main.css";

export function KanopiHost({ role }: { role: GateRole }) {
  const navigate = useNavigate();

  useEffect(() => {
    const w = window as Window & {
      __kanopiLogout?: () => Promise<void>;
      __kanopiRole?: GateRole;
    };
    w.__kanopiLogout = async () => {
      await gateLogout();
      await navigate({ to: "/login" });
    };
    // Set before the dynamic import resolves so Sidebar/views see the role
    // the moment they mount.
    w.__kanopiRole = role;

    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@/kanopi/main.js").then((mod) => {
      if (cancelled) return;
      stop = mod.startKanopi();
    });
    return () => {
      cancelled = true;
      stop?.();
      delete w.__kanopiLogout;
      delete w.__kanopiRole;
    };
  }, [navigate, role]);

  return (
    <div id="app">
      <aside id="sidebar" />
      <main id="content" />
    </div>
  );
}
