// Town-level map for ResultsPageUI.show_town_map() (docs/decisions.md #16). The dataset has no
// coordinates, so the map is centred on the town; coordinates are approximate town centres.
import { titleCase } from "./format.js";

export const TOWN_CENTRES = {
  "ANG MO KIO": [1.3691, 103.8454],
  BEDOK: [1.3236, 103.9273],
  BISHAN: [1.3526, 103.8352],
  "BUKIT BATOK": [1.359, 103.7637],
  "BUKIT MERAH": [1.2819, 103.8239],
  "BUKIT PANJANG": [1.3774, 103.7719],
  "BUKIT TIMAH": [1.3294, 103.8021],
  "CENTRAL AREA": [1.2894, 103.85],
  "CHOA CHU KANG": [1.384, 103.747],
  CLEMENTI: [1.3162, 103.7649],
  GEYLANG: [1.3201, 103.8918],
  HOUGANG: [1.3612, 103.8863],
  "JURONG EAST": [1.3329, 103.7436],
  "JURONG WEST": [1.3404, 103.709],
  "KALLANG/WHAMPOA": [1.31, 103.8651],
  "MARINE PARADE": [1.302, 103.907],
  "PASIR RIS": [1.3721, 103.9474],
  PUNGGOL: [1.3984, 103.9072],
  QUEENSTOWN: [1.2942, 103.7861],
  SEMBAWANG: [1.4491, 103.8185],
  SENGKANG: [1.3868, 103.8914],
  SERANGOON: [1.3554, 103.8679],
  TAMPINES: [1.3496, 103.9568],
  "TOA PAYOH": [1.3343, 103.8563],
  WOODLANDS: [1.4382, 103.789],
  YISHUN: [1.4304, 103.8354],
};

export default function TownMap({ town }) {
  const centre = TOWN_CENTRES[town];
  if (!centre) {
    return (
      <div className="card card-body">
        <p className="muted">A map is not available for {titleCase(town)}.</p>
      </div>
    );
  }
  const [lat, lon] = centre;
  const bbox = [lon - 0.025, lat - 0.015, lon + 0.025, lat + 0.015].map((n) => n.toFixed(4)).join(",");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
  return (
    <figure className="card town-map">
      <iframe title={`Map of ${titleCase(town)}`} src={src} loading="lazy" />
      <figcaption>
        Approximate centre of {titleCase(town)} ·{" "}
        <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`} target="_blank" rel="noreferrer">
          Open larger map
        </a>{" "}
        · © OpenStreetMap contributors
      </figcaption>
    </figure>
  );
}
