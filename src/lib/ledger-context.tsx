import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MillRecord } from "@/lib/ledger";

type Api = {
  mills: MillRecord[];
  ready: boolean;
  selectedChain: string | null;
  setSelectedChain: (id: string | null) => void;
};

const Ctx = createContext<Api | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [mills, setMills] = useState<MillRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedChain, setSelectedChain] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/data/mills.json")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MillRecord[]) => {
        if (alive) setMills(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (alive) setMills([]);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<Api>(
    () => ({ mills, ready, selectedChain, setSelectedChain }),
    [mills, ready, selectedChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLedger outside LedgerProvider");
  return ctx;
}
