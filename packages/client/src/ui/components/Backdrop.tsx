/**
 * Menu backdrop: layered gradient glows (CSS) and a girih lattice built from
 * eight-point stars as an SVG <pattern>, so it tiles at any resolution.
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <svg className="backdrop__pattern" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="girih" width="128" height="128" patternUnits="userSpaceOnUse">
            <g fill="none" stroke="currentColor" strokeWidth="1">
              {/* central octagram */}
              <rect x="36" y="36" width="56" height="56" />
              <rect x="36" y="36" width="56" height="56" transform="rotate(45 64 64)" />
              {/* corner octagrams (each quarter completes across tiles) */}
              {[[0, 0], [128, 0], [0, 128], [128, 128]].map(([cx, cy]) => (
                <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
                  <rect x="-14" y="-14" width="28" height="28" />
                  <rect x="-14" y="-14" width="28" height="28" transform="rotate(45)" />
                </g>
              ))}
              {/* connecting strapwork */}
              <path d="M64 0v36M64 92v128M0 64h36M92 64h36" />
              <path d="M20 20l16 16M108 20l-16 16M20 108l16-16M108 108l-16-16" strokeOpacity="0.6" />
            </g>
            <circle cx="64" cy="64" r="2" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#girih)" />
      </svg>
      <div className="backdrop__vignette" />
    </div>
  );
}
