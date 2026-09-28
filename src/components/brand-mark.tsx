/**
 * The canopy mark. "dark" (default) sits on light surfaces; "light" on the
 * navy workspace chrome and the dark public site.
 */
export function BrandMark({ size = 28, variant = "dark" }: { size?: number; variant?: "dark" | "light" }) {
  return (
    <img
      className="mark"
      src={variant === "light" ? "/brand/palmtrace-mark-light.svg" : "/brand/palmtrace-mark.svg"}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
