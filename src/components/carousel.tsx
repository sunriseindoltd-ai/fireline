import { useState, type ReactNode } from "react";

type Props = {
  slides: ReactNode[];
  prevLabel: string;
  nextLabel: string;
  /** Must contain "{n}" and "{total}" placeholders. */
  slideOfLabel: string;
};

function ArrowIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points={direction === "prev" ? "15 5 8 12 15 19" : "9 5 16 12 9 19"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One-slide-at-a-time viewport with dot jump-nav and edge arrows — used to
 * replace a long vertical stack of cards (e.g. the sidebar mill summary's
 * KPI grid + 6 charts) with something that fits a fixed-height panel
 * without scrolling. Loops at both ends rather than disabling the arrows,
 * since a slideshow reads more naturally that way than a dead-ended list.
 */
export function Carousel({ slides, prevLabel, nextLabel, slideOfLabel }: Props) {
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  if (count === 0) return null;

  return (
    <div className="carousel">
      <div className="carousel-viewport">
        {count > 1 ? (
          <button type="button" className="carousel-arrow prev" onClick={() => go(-1)} aria-label={prevLabel}>
            <ArrowIcon direction="prev" />
          </button>
        ) : null}
        <div className="carousel-slide" key={index}>
          {slides[index]}
        </div>
        {count > 1 ? (
          <button type="button" className="carousel-arrow next" onClick={() => go(1)} aria-label={nextLabel}>
            <ArrowIcon direction="next" />
          </button>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="carousel-dots">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`carousel-dot ${i === index ? "on" : ""}`}
              onClick={() => setIndex(i)}
              aria-label={slideOfLabel.replaceAll("{n}", String(i + 1)).replaceAll("{total}", String(count))}
              aria-current={i === index}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
