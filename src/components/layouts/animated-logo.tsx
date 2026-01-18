interface AnimatedLogoProps {
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const LOGO_IMAGE_PATH = "/shadower-logo-final.png";
const LOGO_ALT_TEXT = "Shadower";

export function AnimatedLogo({
  width = 80,
  height = 80,
  className = "",
}: AnimatedLogoProps) {
  return (
    <div
      className="relative inline-block"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_IMAGE_PATH}
        alt={LOGO_ALT_TEXT}
        width={width}
        height={height}
        style={{ filter: "var(--logo-filter)" }}
        className={className}
        loading="lazy"
      />
    </div>
  );
}
