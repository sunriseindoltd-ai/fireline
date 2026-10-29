/** The FireLine mark: the Earthline three-circle canopy in reds. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <img className="mark" src="/brand/fireline-mark.svg" alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
}

/** "FireLine": "Fire" in red, "Line" in grey. */
export function FireWord() {
  return (
    <>
      <span className="fire-red">Fire</span>
      <span className="fire-grey">Line</span>
    </>
  );
}
