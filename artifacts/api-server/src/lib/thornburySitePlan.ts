/**
 * Thornbury at Chase Oaks — unit site plan derived from the leasing office maps.
 * Coordinates are canvas fractions (0..1). y=0 is the north / top of the site plan.
 * Building centroids approximate the overview board; units pack inside each building.
 *
 * Address pin used by Halo seed: ~33.0705, -96.751 (Plano / Chase Oaks).
 */

export type SiteUnitBox = {
  label: string;
  building: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Building footprint centers on the overview map (fractional). */
export const BUILDING_CENTER_EXPORT: Record<number, { x: number; y: number }> = {
  1: { x: 0.40, y: 0.72 },
  2: { x: 0.30, y: 0.80 },
  3: { x: 0.34, y: 0.58 },
  4: { x: 0.28, y: 0.50 },
  5: { x: 0.18, y: 0.40 },
  6: { x: 0.24, y: 0.32 },
  7: { x: 0.34, y: 0.30 },
  8: { x: 0.44, y: 0.40 },
  9: { x: 0.42, y: 0.26 },
  10: { x: 0.52, y: 0.24 },
  11: { x: 0.54, y: 0.42 },
  12: { x: 0.60, y: 0.50 },
  13: { x: 0.72, y: 0.50 },
  14: { x: 0.68, y: 0.38 },
  15: { x: 0.56, y: 0.16 },
  16: { x: 0.64, y: 0.14 },
  17: { x: 0.74, y: 0.12 },
  18: { x: 0.84, y: 0.12 },
  19: { x: 0.80, y: 0.30 },
  20: { x: 0.84, y: 0.44 },
};

/**
 * Unit numbers read from building close-ups (unit # only — floorplan codes stripped).
 * Order is left→right, top→bottom within each building where readable.
 */
export const BUILDING_UNITS_EXPORT: Record<number, string[]> = {
  1: [
    "114", "124", "115", "125",
    "113", "123", "116", "126",
    "112", "122", "117", "127",
    "111", "121", "118", "128",
  ],
  2: ["212", "222", "211", "221", "213", "223", "214", "224"],
  3: [
    "338", "328", "318", "337", "327", "317", "336", "326", "316", "335", "325", "315",
    "331", "321", "311", "332", "322", "312", "333", "323", "313", "334", "324", "314",
  ],
  4: [
    "411", "421", "431", "418", "428", "438",
    "412", "422", "432", "417", "427", "437",
    "413", "423", "433", "416", "426", "436",
    "414", "424", "434", "415", "425", "435",
  ],
  5: [
    "538", "528", "518", "537", "527", "517", "536", "526", "516", "535", "525", "515",
    "531", "521", "511", "532", "522", "512", "533", "523", "513", "534", "524", "514",
  ],
  6: [
    "638", "628", "618", "637", "627", "617", "636", "626", "616", "635", "625", "615",
    "631", "621", "611", "632", "622", "612", "633", "623", "613", "634", "624", "614",
  ],
  7: [
    "734", "724", "714", "733", "723", "713",
    "731", "721", "711", "732", "722", "712",
  ],
  8: [
    "814", "824", "834", "813", "823", "833", "812", "822", "832", "811", "821", "831",
    "815", "825", "835", "816", "826", "836", "817", "827", "837", "818", "828", "838",
  ],
  9: [
    "934", "924", "914", "933", "923", "913",
    "931", "921", "911", "932", "922", "912",
  ],
  10: [
    "1038", "1028", "1018", "1037", "1027", "1017", "1036", "1026", "1016", "1035", "1025", "1015",
    "1031", "1021", "1011", "1032", "1022", "1012", "1033", "1023", "1013", "1034", "1024", "1014",
  ],
  11: [
    "1133", "1123", "1113", "1132", "1122", "1112",
    "1134", "1124", "1114", "1131", "1121", "1111",
  ],
  12: [
    "1214", "1224", "1213", "1223", "1212", "1222", "1211", "1221",
    "1215", "1225", "1216", "1226", "1217", "1227", "1218", "1228",
  ],
  13: [
    "1314", "1324", "1313", "1323", "1312", "1322", "1311", "1321",
    "1315", "1325", "1316", "1326", "1317", "1327", "1318", "1328",
  ],
  14: [
    "1435", "1425", "1415", "1434", "1424", "1414",
    "1436", "1426", "1416", "1433", "1423", "1413",
    "1437", "1427", "1417", "1432", "1422", "1412",
    "1438", "1428", "1418", "1431", "1421", "1411",
  ],
  15: [
    "1533", "1523", "1513", "1532", "1522", "1512",
    "1534", "1524", "1514", "1531", "1521", "1511",
  ],
  16: [
    "1638", "1628", "1618", "1637", "1627", "1617", "1636", "1626", "1616", "1635", "1625", "1615",
    "1631", "1621", "1611", "1632", "1622", "1612", "1633", "1623", "1613", "1634", "1624", "1614",
  ],
  17: [
    "1738", "1728", "1718", "1737", "1727", "1717", "1736", "1726", "1716", "1735", "1725", "1715",
    "1731", "1721", "1711", "1732", "1722", "1712", "1733", "1723", "1713", "1734", "1724", "1714",
  ],
  18: [
    "1838", "1828", "1818", "1837", "1827", "1817", "1836", "1826", "1816", "1835", "1825", "1815",
    "1831", "1821", "1811", "1832", "1822", "1812", "1833", "1823", "1813", "1834", "1824", "1814",
  ],
  19: [
    "1938", "1928", "1918", "1937", "1927", "1917", "1936", "1926", "1916", "1935", "1925", "1915",
    "1931", "1921", "1911", "1932", "1922", "1912", "1933", "1923", "1913", "1934", "1924", "1914",
  ],
  20: ["2023", "2013", "2022", "2012", "2024", "2014", "2021", "2011"],
};

const CELL_W = 0.018;
const CELL_H = 0.014;

function packBuilding(building: number, labels: string[]): SiteUnitBox[] {
  const center = BUILDING_CENTER_EXPORT[building];
  if (!center) return [];
  const cols = Math.ceil(Math.sqrt(labels.length * 1.4));
  const rows = Math.ceil(labels.length / cols);
  const totalW = cols * CELL_W;
  const totalH = rows * CELL_H;
  const originX = center.x - totalW / 2;
  const originY = center.y - totalH / 2;
  return labels.map((label, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      label,
      building,
      x: Math.min(0.97, Math.max(0.01, originX + col * CELL_W)),
      y: Math.min(0.97, Math.max(0.01, originY + row * CELL_H)),
      w: CELL_W * 0.92,
      h: CELL_H * 0.88,
    };
  });
}

/** Full site plate — every residential unit from the leasing maps. */
export function buildThornburySiteUnits(): SiteUnitBox[] {
  const out: SiteUnitBox[] = [];
  for (const [b, labels] of Object.entries(BUILDING_UNITS_EXPORT)) {
    out.push(...packBuilding(Number(b), labels));
  }
  // Leasing office / common (not a residential unit box, but useful on plate)
  out.push({
    label: "Leasing",
    building: 0,
    x: 0.455,
    y: 0.505,
    w: 0.05,
    h: 0.035,
  });
  return out;
}

export function thornburyUnitCount(): number {
  return Object.values(BUILDING_UNITS_EXPORT).reduce((n, a) => n + a.length, 0);
}

export const THORNBURY_SITE_META = {
  name: "Thornbury at Chase Oaks",
  address: "7101 Chase Oaks Blvd, Plano, TX",
  lat: 33.0705,
  lng: -96.751,
  buildings: 20,
  unitCount: thornburyUnitCount(),
} as const;


/**
 * Ground control points — image fraction → real-world WGS84.
 * Anchored on leasing office (~map center) + site extents estimated from
 * Chase Oaks Blvd / Oak Ridge Drive orientation on the wall board.
 * Refine in QGIS with 4+ points against satellite for survey-grade accuracy.
 */
export const THORNBURY_GCPS = [
  { ix: 0.48, iy: 0.52, lat: 33.0705, lng: -96.7510, label: "Leasing 7101" },
  { ix: 0.22, iy: 0.78, lat: 33.0696, lng: -96.7522, label: "SW near Oak Ridge" },
  { ix: 0.88, iy: 0.18, lat: 33.0716, lng: -96.7496, label: "NE buildings 17–18" },
  { ix: 0.82, iy: 0.55, lat: 33.0702, lng: -96.7498, label: "E near Chase Oaks Blvd" },
] as const;


/** Map unit number → building (Thornbury numbering: 1xxx → bldg 1, 12xx → 12, etc.). */
export function unitToBuilding(unitNo: string): number | null {
  const digits = String(unitNo).replace(/\D/g, "");
  if (!digits) return null;
  // 4-digit: first 1–2 digits are building (1011 → 10, 1224 → 12, 211 → 2)
  if (digits.length >= 4) {
    const two = Number(digits.slice(0, 2));
    if (two >= 1 && two <= 20) return two;
  }
  if (digits.length === 3) {
    const one = Number(digits[0]);
    if (one >= 1 && one <= 9) return one;
  }
  // search catalog
  for (const [b, list] of Object.entries(BUILDING_UNITS_EXPORT)) {
    if (list.includes(digits) || list.includes(unitNo)) return Number(b);
  }
  return null;
}
