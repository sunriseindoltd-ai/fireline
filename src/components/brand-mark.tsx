export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      className="mark"
      src="/kanopi-mark.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}
