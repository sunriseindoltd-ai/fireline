import { useState } from "react";

/**
 * Before/after slider: the same view in two images, split by a draggable
 * handle. Built on a native range input so it works with keyboard and
 * touch and is announced properly by screen readers.
 */
export function CompareSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
  label,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  label: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare-slider" style={{ ["--pos" as string]: `${pos}%` }}>
      <img src={after} alt="" loading="lazy" decoding="async" />
      <img src={before} alt="" loading="lazy" decoding="async" className="cs-before" />
      <span className="cs-tag left">{beforeLabel}</span>
      <span className="cs-tag right">{afterLabel}</span>
      <span className="cs-handle" aria-hidden="true">
        <i>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </i>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}
