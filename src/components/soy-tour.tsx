import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type TourStep = {
  /** CSS selector of the element the step points at; none = a centred card. */
  target?: string;
  /** Workspace tab the step needs open (the tour switches to it). */
  tab?: string;
  title: string;
  body: string;
};

/** Per product, so finishing one product's tour doesn't skip the other's. */
export const SOY_TOUR_KEY = "soytrace.tourDone";
export const PALM_TOUR_KEY = "palmtrace.tourDone";

/** Whether the tour should open: once per login (the login page clears the flag). */
export function tourPending(key: string = SOY_TOUR_KEY): boolean {
  try {
    return localStorage.getItem(key) !== "1";
  } catch {
    return false;
  }
}
export function markTourDone(key: string = SOY_TOUR_KEY) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the tour just shows again next time.
  }
}
/** Called after a successful login so the next workspace visit shows each tour once. */
export function resetTour() {
  try {
    localStorage.removeItem(SOY_TOUR_KEY);
    localStorage.removeItem(PALM_TOUR_KEY);
  } catch {
    // ignore
  }
}

const PAD = 6;
const CARD_W = 340;
const GAP = 12;

/**
 * A short guided tour: the page dims, one element at a time is lit, and a
 * card beside it says how to read it. Back / Next / Skip, arrow keys and Esc.
 */
export function SoyTour({
  steps,
  labels,
  onClose,
  onStep,
  product = "soy",
}: {
  steps: TourStep[];
  labels: { next: string; back: string; skip: string; done: string; stepOf: string };
  onClose: () => void;
  /** Called on every step (the workspace opens the step's tab). */
  onStep?: (step: TourStep) => void;
  /** Accent colours of the card's buttons. */
  product?: "soy" | "palm";
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  const [vh, setVh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const scrolledFor = useRef(-1);

  useEffect(() => {
    onStep?.(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const measure = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const el = step.target ? document.querySelector(step.target) : null;
    // Bring the element into view once per step (summary sections sit below the fold).
    if (el && scrolledFor.current !== i) {
      scrolledFor.current = i;
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    }
    const r = el?.getBoundingClientRect();
    setRect(r && r.width > 0 && r.height > 0 ? r : null);
  }, [step.target, i]);

  useLayoutEffect(() => {
    measure();
    // Panels and map cards can appear a moment later; keep the spotlight on them.
    const id = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  useEffect(() => {
    cardRef.current?.focus();
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((v) => Math.min(v + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, steps.length]);

  // Card beside the lit element: below, above, right or left — whichever fits.
  let style: CSSProperties;
  if (!rect) {
    style = { left: Math.max(16, (vw - CARD_W) / 2), top: Math.max(16, vh / 2 - 120) };
  } else {
    const cardH = cardRef.current?.offsetHeight ?? 200;
    const clampX = (x: number) => Math.min(Math.max(16, x), vw - CARD_W - 16);
    const clampY = (y: number) => Math.min(Math.max(16, y), vh - cardH - 16);
    if (rect.bottom + GAP + cardH < vh - 8) style = { left: clampX(rect.left), top: rect.bottom + PAD + GAP };
    else if (rect.top - GAP - cardH > 8) style = { left: clampX(rect.left), top: rect.top - PAD - GAP - cardH };
    else if (rect.right + GAP + CARD_W < vw - 8) style = { left: rect.right + PAD + GAP, top: clampY(rect.top) };
    else style = { left: Math.max(16, rect.left - PAD - GAP - CARD_W), top: clampY(rect.top) };
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="tour-layer" data-product={product}>
      <div className="tour-block" aria-hidden="true" />
      {rect ? (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        style={{ ...style, width: CARD_W }}
      >
        <p className="tour-count">{labels.stepOf.replace("{n}", String(i + 1)).replace("{total}", String(steps.length))}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          {last ? null : (
            <button type="button" className="btn-text" onClick={onClose}>
              {labels.skip}
            </button>
          )}
          <span className="tour-spacer" />
          {i > 0 ? (
            <button type="button" className="btn-secondary" onClick={() => setI(i - 1)}>
              {labels.back}
            </button>
          ) : null}
          <button type="button" className="btn-primary" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? labels.done : labels.next}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
