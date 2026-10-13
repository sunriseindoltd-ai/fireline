/** The Earthline canopy mark. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <img className="mark" src="/brand/palmtrace-mark.svg" alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
}
