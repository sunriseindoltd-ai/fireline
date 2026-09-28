import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

const SLIDES = ["portfolio", "summary", "map", "plots"] as const;
const INTERVAL_MS = 6000;

/**
 * A quiet product tour in the manner of Samsung's product pages: a few
 * workspace screens that cross-fade on their own, with a tab row whose
 * active tab fills as its time runs out. Pauses on hover/focus, can be
 * paused outright, and doesn't auto-advance for reduced-motion users.
 * Screens are captured from the real workspace with names, places and
 * figures replaced (scripts/capture-showcase.mjs).
 */
export function ProductShowcase() {
  const { s, lang } = useI18n();
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    try {
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      /* old browser — keep motion */
    }
  }, []);

  const running = !hovered && !paused && !reduced;
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearTimeout(id);
  }, [index, running]);

  const titles = [s.sc1Title, s.sc2Title, s.sc3Title, s.sc4Title];
  const bodies = [s.sc1Body, s.sc2Body, s.sc3Body, s.sc4Body];

  return (
    <div
      className={`showcase ${running ? "running" : ""}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <div className="showcase-tabs" role="tablist">
        {SLIDES.map((key, i) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? "on" : ""}
            onClick={() => setIndex(i)}
          >
            <b>{titles[i]}</b>
            <span>{bodies[i]}</span>
            <i className="showcase-progress" aria-hidden="true">
              <i key={`${index}-${running}`} style={{ animationDuration: `${INTERVAL_MS}ms` }} />
            </i>
          </button>
        ))}
      </div>
      <div className="showcase-stage">
        {SLIDES.map((key, i) => (
          <img
            key={key}
            src={`/img/showcase/${key}-${lang}.jpg`}
            alt={titles[i]}
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            className={i === index ? "on" : ""}
            aria-hidden={i !== index}
          />
        ))}
        <button type="button" className="showcase-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? s.showcasePlay : s.showcasePause}
        </button>
      </div>
      <p className="showcase-note">{s.showcaseNote}</p>
    </div>
  );
}
