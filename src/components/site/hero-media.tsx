import { useI18n } from "@/lib/i18n";

/**
 * The public site's "product photograph": a Sentinel-2 still (2020 median,
 * Copernicus data — free to use with attribution) with the outlines of one
 * mill's plots from a PalmTrace analysis baked in. Only compliant plots are
 * drawn, and the image carries no names, labels or coordinates
 * (scripts/render-field-still.mjs). The floating panel is sample UI.
 */
export function HeroMedia() {
  const { s } = useI18n();
  return (
    <figure className="hero-media">
      <div className="hero-frame">
        <img src="/img/field-2020.jpg" alt="" width={2048} height={1280} fetchPriority="high" decoding="async" />
        <div className="hero-card hero-card-inspector" aria-hidden="true">
          <p className="hc-title">
            {s.shotMill}
            <em>{s.shotSample}</em>
          </p>
          <dl>
            <div>
              <dt>{s.shotTrace}</dt>
              <dd>{s.shotTraceValue}</dd>
            </div>
            <div>
              <dt>{s.shotCutoff}</dt>
              <dd>{s.shotCutoffValue}</dd>
            </div>
            <div>
              <dt>{s.shotVerdict}</dt>
              <dd className="ok">
                <i />
                {s.shotVerdictValue}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption>{s.imageCaption}</figcaption>
    </figure>
  );
}
