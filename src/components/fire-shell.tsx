import { useEffect, useState } from "react";
import { FirePage } from "@/components/fire-page";
import { NationalPage } from "@/components/fire-national";
import { useI18n } from "@/lib/i18n";
import { nationalCopy } from "@/lib/fire-national-copy";

type Space = "id" | "sc";
const STORE = "fireline.space";
const SC_VIEWS = ["home", "inbox", "map", "history", "events", "summary"];

/** Which workspace a URL hash belongs to (`#id…` = Indonesia, the supply-chain views otherwise), or null. */
function spaceOfHash(): Space | null {
  const h = window.location.hash.replace(/^#/, "").split("/")[0];
  if (h === "id") return "id";
  return SC_VIEWS.includes(h) ? "sc" : null;
}

/**
 * Two workspaces (user decision, 27 Oct 2026): FireLine Indonesia for every account, and the supply-chain
 * cases (field verification, sales attribution) for Earthline staff only.
 */
export function FireShell({ role, org }: { role: string; org?: string }) {
  // Earthline staff and company accounts (their own estates) both get the cases workspace.
  const staff = role === "admin" || role === "company";
  // Staff start where they left off; the first time, on the supply chain (their daily work).
  const [space, setSpace] = useState<Space>(staff ? "sc" : "id");
  useEffect(() => {
    if (!staff) return;
    let s = spaceOfHash();
    // a company account always opens on its own company (user, 2 Nov 2026)
    if (!s && role === "company") s = "sc";
    if (!s) {
      try {
        s = localStorage.getItem(STORE) === "id" ? "id" : "sc";
      } catch {
        s = "sc";
      }
    }
    setSpace(s);
    const onPop = () => {
      const h = spaceOfHash();
      if (h) setSpace(h);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [staff, role]);
  const pick = (s: Space) => {
    setSpace(s);
    try {
      localStorage.setItem(STORE, s);
    } catch {}
    window.history.pushState(null, "", s === "id" ? "#id" : role === "company" ? "#home" : "#inbox");
  };
  const sw = staff ? <SpaceSwitch space={space} onChange={pick} own={role === "company" ? org : undefined} /> : undefined;
  return space === "sc" && staff ? <FirePage role={role} org={org} spaceSwitch={sw} /> : <NationalPage spaceSwitch={sw} />;
}

function SpaceSwitch({ space, onChange, own }: { space: Space; onChange: (s: Space) => void; own?: string }) {
  const { lang } = useI18n();
  const f = nationalCopy[lang];
  return (
    <div className={`seg fl-space ${own ? "own" : ""}`} role="group" aria-label={f.spaceLabel}>
      {(own
        ? ([
            ["sc", own],
            ["id", f.spaceId],
          ] as const)
        : ([
            ["id", f.spaceId],
            ["sc", f.spaceSc],
          ] as const)
      ).map(([k, label]) => (
        <button key={k} type="button" data-k={k} title={label} className={space === k ? "on" : ""} aria-pressed={space === k} onClick={() => space !== k && onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}
