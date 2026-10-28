// Decorative HDB-block skyline for the home page hero (aria-hidden; purely visual).
const BLOCKS = [
  [0, 70, 60], [64, 110, 46], [114, 54, 70], [188, 128, 52], [244, 86, 64], [312, 150, 48], [364, 96, 72],
  [440, 132, 54], [498, 72, 66], [568, 160, 50], [622, 104, 62], [688, 140, 46], [738, 80, 70], [812, 120, 56],
  [872, 168, 48], [924, 92, 66], [994, 136, 52], [1050, 76, 70], [1124, 152, 50], [1178, 100, 64], [1246, 124, 54],
  [1304, 84, 68], [1376, 146, 52], [1432, 96, 60],
];

export default function Skyline() {
  return (
    <svg className="hero-skyline" viewBox="0 0 1500 180" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {BLOCKS.map(([x, h, w]) => (
        <g key={x}>
          <rect x={x} y={180 - h} width={w} height={h} fill="currentColor" />
          {Array.from({ length: Math.floor(h / 14) - 1 }, (_, row) => (
            <rect key={row} x={x + 6} y={180 - h + 10 + row * 14} width={w - 12} height={3} fill="rgba(255,255,255,0.05)" />
          ))}
        </g>
      ))}
    </svg>
  );
}
