using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Thornbury at Chase Oaks (7101 Chase Oaks Blvd, Plano) — 20 garden buildings,
    /// 3 stories, leasing office at center. Fractions match the leasing wall map.
    /// </summary>
    public static class ThornburySitePlan
    {
        public const string Name = "Thornbury at Chase Oaks";
        public const string Address = "7101 Chase Oaks Blvd, Plano, TX 75025";
        // Google Geocoding GEOMETRIC_CENTER for that street address.
        public const double Lat = 33.0732679;
        public const double Lng = -96.6955596;
        /// <summary>WGS84 ellipsoid height (MSL 181 m + ~28 m DFW geoid).</summary>
        public const double EllipsoidHeightM = 209.0;

        public struct Bldg
        {
            public int number;
            public float ix;
            public float iy;
            public int units;
            public bool leasing;
        }

        public static readonly Bldg[] Buildings =
        {
            new Bldg { number = 1, ix = 0.40f, iy = 0.72f, units = 16 },
            new Bldg { number = 2, ix = 0.30f, iy = 0.80f, units = 8 },
            new Bldg { number = 3, ix = 0.34f, iy = 0.58f, units = 24 },
            new Bldg { number = 4, ix = 0.28f, iy = 0.50f, units = 24 },
            new Bldg { number = 5, ix = 0.18f, iy = 0.40f, units = 24 },
            new Bldg { number = 6, ix = 0.24f, iy = 0.32f, units = 24 },
            new Bldg { number = 7, ix = 0.34f, iy = 0.30f, units = 12 },
            new Bldg { number = 8, ix = 0.44f, iy = 0.40f, units = 24 },
            new Bldg { number = 9, ix = 0.42f, iy = 0.26f, units = 12 },
            new Bldg { number = 10, ix = 0.52f, iy = 0.24f, units = 24 },
            new Bldg { number = 11, ix = 0.54f, iy = 0.42f, units = 12 },
            new Bldg { number = 12, ix = 0.60f, iy = 0.50f, units = 16 },
            new Bldg { number = 13, ix = 0.72f, iy = 0.50f, units = 16 },
            new Bldg { number = 14, ix = 0.68f, iy = 0.38f, units = 24 },
            new Bldg { number = 15, ix = 0.56f, iy = 0.16f, units = 12 },
            new Bldg { number = 16, ix = 0.64f, iy = 0.14f, units = 24 },
            new Bldg { number = 17, ix = 0.74f, iy = 0.12f, units = 24 },
            new Bldg { number = 18, ix = 0.84f, iy = 0.12f, units = 24 },
            new Bldg { number = 19, ix = 0.80f, iy = 0.30f, units = 24 },
            new Bldg { number = 20, ix = 0.84f, iy = 0.44f, units = 8 },
            new Bldg { number = 0, ix = 0.455f, iy = 0.505f, units = 0, leasing = true },
        };

        struct Gcp { public float ix, iy; public double lat, lng; }

        static readonly Gcp[] Gcps =
        {
            new Gcp { ix = 0.48f, iy = 0.52f, lat = 33.0732679, lng = -96.6955596 },
            new Gcp { ix = 0.22f, iy = 0.78f, lat = 33.0723679, lng = -96.6967596 },
            new Gcp { ix = 0.88f, iy = 0.18f, lat = 33.0743679, lng = -96.6941596 },
            new Gcp { ix = 0.82f, iy = 0.55f, lat = 33.0729679, lng = -96.6943596 },
        };

        // lng = a*ix + b*iy + c ; lat = d*ix + e*iy + f
        static double _a, _b, _c, _d, _e, _f;
        static bool _fit;

        public static void ImageToLatLng(float ix, float iy, out double lat, out double lng)
        {
            EnsureFit();
            lng = _a * ix + _b * iy + _c;
            lat = _d * ix + _e * iy + _f;
        }

        public static Vector3 ImageToWorld(float ix, float iy)
        {
            ImageToLatLng(ix, iy, out var lat, out var lng);
            return TwinWorld.LatLngToWorld(lat, lng, Lat, Lng);
        }

        public static int UnitCount(int building)
        {
            foreach (var b in Buildings)
                if (b.number == building) return b.units;
            return 12;
        }

        static void EnsureFit()
        {
            if (_fit) return;
            _fit = true;
            var lng = SolveAxis(true);
            var lat = SolveAxis(false);
            if (lng == null || lat == null) return;
            _a = lng[0]; _b = lng[1]; _c = lng[2];
            _d = lat[0]; _e = lat[1]; _f = lat[2];
        }

        static double[] SolveAxis(bool lngAxis)
        {
            double sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0;
            double stx = 0, sty = 0, st = 0;
            foreach (var g in Gcps)
            {
                var t = lngAxis ? g.lng : g.lat;
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
            return Solve3(
                new[] { sxx, sxy, sx, sxy, syy, sy, sx, sy, n },
                new[] { stx, sty, st });
        }

        static double[] Solve3(double[] m, double[] v)
        {
            var a = new double[3, 3];
            var b = new double[3];
            for (int r = 0; r < 3; r++)
            {
                b[r] = v[r];
                for (int c = 0; c < 3; c++) a[r, c] = m[r * 3 + c];
            }
            for (int col = 0; col < 3; col++)
            {
                int piv = col;
                for (int r = col + 1; r < 3; r++)
                    if (System.Math.Abs(a[r, col]) > System.Math.Abs(a[piv, col])) piv = r;
                if (System.Math.Abs(a[piv, col]) < 1e-12) return null;
                for (int c = 0; c < 3; c++) { var t = a[col, c]; a[col, c] = a[piv, c]; a[piv, c] = t; }
                { var t = b[col]; b[col] = b[piv]; b[piv] = t; }
                var div = a[col, col];
                for (int c = col; c < 3; c++) a[col, c] /= div;
                b[col] /= div;
                for (int r = 0; r < 3; r++)
                {
                    if (r == col) continue;
                    var f = a[r, col];
                    for (int c = col; c < 3; c++) a[r, c] -= f * a[col, c];
                    b[r] -= f * b[col];
                }
            }
            return b;
        }
    }
}
