/**
 * Site-plan georeferencing — QGIS-style control points → affine map.
 * Image fractions (0..1) ↔ WGS84. Used so Site Twin can overlay the
 * leasing board and snap crew GPS to the same plate.
 */

export type Gcp = {
  /** 0..1 on the site-plan image (x right, y down) */
  ix: number;
  iy: number;
  lat: number;
  lng: number;
  label?: string;
};

export type GeoBBox = { south: number; west: number; north: number; east: number };

/**
 * Least-squares affine: lng = a*ix + b*iy + c, lat = d*ix + e*iy + f
 * Needs ≥3 non-collinear GCPs. With 2 points, falls back to simple scale.
 */
export function fitAffine(gcps: Gcp[]): {
  a: number; b: number; c: number; d: number; e: number; f: number;
} | null {
  if (gcps.length < 2) return null;
  if (gcps.length === 2) {
    const [p0, p1] = gcps;
    const dx = p1.ix - p0.ix || 1e-9;
    const dy = p1.iy - p0.iy || 1e-9;
    // crude: ignore rotation coupling
    const a = (p1.lng - p0.lng) / dx;
    const e = (p1.lat - p0.lat) / dy;
    return {
      a,
      b: 0,
      c: p0.lng - a * p0.ix,
      d: 0,
      e,
      f: p0.lat - e * p0.iy,
    };
  }
  // Solve normal equations for 3-param each axis independently with ix,iy,1
  const solve = (target: "lat" | "lng") => {
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0;
    let stx = 0, sty = 0, st = 0;
    for (const g of gcps) {
      const t = target === "lat" ? g.lat : g.lng;
      sxx += g.ix * g.ix;
      sxy += g.ix * g.iy;
      sx += g.ix;
      syy += g.iy * g.iy;
      sy += g.iy;
      n += 1;
      stx += t * g.ix;
      sty += t * g.iy;
      st += t;
    }
    // 3x3 system
    const m = [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ];
    const v = [stx, sty, st];
    const sol = solve3(m, v);
    return sol;
  };
  const lng = solve("lng");
  const lat = solve("lat");
  if (!lng || !lat) return null;
  return { a: lng[0], b: lng[1], c: lng[2], d: lat[0], e: lat[1], f: lat[2] };
}

function solve3(m: number[][], v: number[]): number[] | null {
  const a = m.map((row) => row.slice());
  const b = v.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const div = a[col][col];
    for (let j = col; j < 3; j++) a[col][j] /= div;
    b[col] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = col; j < 3; j++) a[r][j] -= f * a[col][j];
      b[r] -= f * b[col];
    }
  }
  return b;
}

export function imageToLatLng(
  ix: number,
  iy: number,
  coeff: { a: number; b: number; c: number; d: number; e: number; f: number },
): { lat: number; lng: number } {
  return {
    lng: coeff.a * ix + coeff.b * iy + coeff.c,
    lat: coeff.d * ix + coeff.e * iy + coeff.f,
  };
}

/** Bounds of the full image in WGS84 for Leaflet ImageOverlay. */
export function imageBounds(coeff: {
  a: number; b: number; c: number; d: number; e: number; f: number;
}): [[number, number], [number, number]] {
  const corners = [
    imageToLatLng(0, 0, coeff),
    imageToLatLng(1, 0, coeff),
    imageToLatLng(0, 1, coeff),
    imageToLatLng(1, 1, coeff),
  ];
  const lats = corners.map((c) => c.lat);
  const lngs = corners.map((c) => c.lng);
  // Leaflet ImageOverlay wants [[south, west], [north, east]]
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

export function bboxFromCoeff(coeff: {
  a: number; b: number; c: number; d: number; e: number; f: number;
}): GeoBBox {
  const [[south, west], [north, east]] = imageBounds(coeff);
  return { south, west, north, east };
}
