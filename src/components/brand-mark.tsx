/**
 * The canopy mark. "dark" (default) sits on light surfaces; "light" on the
 * navy workspace chrome and the dark public site.
 */
export function BrandMark({
  size = 28,
  variant = "dark",
  product,
}: {
  size?: number;
  variant?: "dark" | "light";
  /** SoyTrace has its own (amber) mark; everything else uses the umbrella one. */
  product?: "palm" | "soy";
}) {
  return (
    <img
      className="mark"
      src={
        product === "soy"
          ? "/brand/soytrace-mark.svg"
          : variant === "light"
            ? "/brand/palmtrace-mark-light.svg"
            : "/brand/palmtrace-mark.svg"
      }
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
