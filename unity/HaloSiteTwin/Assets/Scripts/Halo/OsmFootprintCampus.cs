using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Building layouts are OpenStreetMap WGS84 (ODbL). Every mesh vertex is
    /// projected from OSM lat/lng — the leasing board is only used to stamp
    /// Halo building numbers onto the nearest OSM footprint.
    /// </summary>
    public static class OsmFootprintCampus
    {
        const string FileName = "thornbury-osm-buildings.json";
        const float StoryM = 3.15f;

        [Serializable]
        class OsmFile
        {
            public double originLat;
            public double originLng;
            public OsmBldg[] buildings;
            public OsmWay[] roads;
            public OsmWay[] parking;
        }

        [Serializable]
        class OsmBldg
        {
            public string kind;
            public int levels;
            public int[] latE7;
            public int[] lngE7;
        }

        [Serializable]
        class OsmWay
        {
            public string kind;
            public int[] latE7;
            public int[] lngE7;
        }

        struct Mass
        {
            public GameObject go;
            public Vector3 world;
            public double lat;
            public double lng;
        }

        public static int Build(Transform parent, out Dictionary<int, GameObject> numbered, bool solids = true)
        {
            numbered = new Dictionary<int, GameObject>();
            var json = ReadJson();
            if (string.IsNullOrEmpty(json))
            {
                Debug.LogWarning("[Halo] OSM footprint JSON missing");
                return 0;
            }

            var data = JsonUtility.FromJson<OsmFile>(json);
            if (data?.buildings == null || data.buildings.Length == 0) return 0;

            TwinWorld.SetOrigin(ThornburySitePlan.Lat, ThornburySitePlan.Lng);

            var existing = parent.Find("OsmCampus");
            if (existing != null)
            {
                if (Application.isPlaying) UnityEngine.Object.Destroy(existing.gameObject);
                else UnityEngine.Object.DestroyImmediate(existing.gameObject);
            }

            var campus = new GameObject("OsmCampus");
            campus.transform.SetParent(parent, false);

            if (solids)
            {
                Ground(campus.transform, data.buildings);
                if (data.parking != null)
                    foreach (var p in data.parking) FlatPoly(campus.transform, "Parking", p.latE7, p.lngE7, 0.04f, HaloMaterials.Asphalt);
                if (data.roads != null)
                    foreach (var r in data.roads) Road(campus.transform, r);
            }

            var masses = new List<Mass>();
            var bldgRoot = new GameObject("OsmBuildings");
            bldgRoot.transform.SetParent(campus.transform, false);

            int n = 0;
            foreach (var b in data.buildings)
            {
                if (!TryRing(b.latE7, b.lngE7, out var ring, out var lat, out var lng)) continue;
                var world = TwinWorld.LatLngToWorld(lat, lng);
                GameObject go;
                if (solids)
                {
                    EnsureCcw(ring);
                    int floors = b.levels > 0 ? Mathf.Clamp(b.levels, 1, 5) : 3;
                    var local = new Vector3[ring.Length];
                    for (int i = 0; i < ring.Length; i++) local[i] = ring[i] - world;
                    go = MakeMass($"OSM-{n}", bldgRoot.transform, local, floors * StoryM, Skin(n));
                }
                else
                {
                    go = new GameObject($"OSM-{n}");
                    go.transform.SetParent(bldgRoot.transform, false);
                }
                go.transform.position = world;
                masses.Add(new Mass { go = go, world = world, lat = lat, lng = lng });
                n++;
            }

            NumberFromSitePlan(masses, numbered);
            Debug.Log($"[Halo Twin] OSM WGS84 campus: {n} footprints solids={solids} at {data.originLat:F6},{data.originLng:F6}");
            return n;
        }

        /// <summary>
        /// Photoreal tiles are the exteriors. Keep numbered empties + labels for crews; hide boxes/lawn/roads.
        /// </summary>
        public static void HideSolids(Transform root, bool hide)
        {
            if (root == null) return;
            var campus = root.Find("OsmCampus");
            if (campus == null) return;
            foreach (var r in campus.GetComponentsInChildren<Renderer>(true))
            {
                if (r.GetComponent<TextMesh>() != null) continue;
                r.enabled = !hide;
            }
        }

        static void NumberFromSitePlan(List<Mass> masses, Dictionary<int, GameObject> numbered)
        {
            if (masses.Count == 0) return;
            double minLat = double.MaxValue, maxLat = double.MinValue, minLng = double.MaxValue, maxLng = double.MinValue;
            foreach (var m in masses)
            {
                if (m.lat < minLat) minLat = m.lat;
                if (m.lat > maxLat) maxLat = m.lat;
                if (m.lng < minLng) minLng = m.lng;
                if (m.lng > maxLng) maxLng = m.lng;
            }
            double dLat = Math.Max(1e-9, maxLat - minLat);
            double dLng = Math.Max(1e-9, maxLng - minLng);
            var used = new HashSet<int>();
            foreach (var plan in ThornburySitePlan.Buildings)
            {
                if (plan.leasing) continue;
                float best = float.MaxValue;
                int pick = -1;
                for (int i = 0; i < masses.Count; i++)
                {
                    if (used.Contains(i)) continue;
                    float ix = (float)((masses[i].lng - minLng) / dLng);
                    float iy = (float)((maxLat - masses[i].lat) / dLat); // north = 0, same as leasing map
                    float dx = ix - plan.ix;
                    float dy = iy - plan.iy;
                    float d = dx * dx + dy * dy;
                    if (d < best) { best = d; pick = i; }
                }
                if (pick < 0) continue;
                used.Add(pick);
                var go = masses[pick].go;
                go.name = $"Building {plan.number}";
                numbered[plan.number] = go;
                Label(go.transform, plan.number, 3 * StoryM);
            }
        }

        static void Ground(Transform parent, OsmBldg[] buildings)
        {
            var grass = GameObject.CreatePrimitive(PrimitiveType.Plane);
            grass.name = "Lawn";
            grass.transform.SetParent(parent, false);
            grass.transform.localScale = new Vector3(22f, 1f, 22f);
            grass.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Grass;
            UnityEngine.Object.Destroy(grass.GetComponent<Collider>());
        }

        static void Road(Transform parent, OsmWay way)
        {
            if (!TryRing(way.latE7, way.lngE7, out var pts, out _, out _)) return;
            if (pts.Length < 2) return;
            float half = way.kind == "service" ? 2.4f : 4.2f;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int i = 0; i < pts.Length - 1; i++)
            {
                var a = pts[i]; a.y = 0.05f;
                var b = pts[i + 1]; b.y = 0.05f;
                var dir = (b - a); dir.y = 0;
                if (dir.sqrMagnitude < 0.01f) continue;
                var nrm = Vector3.Cross(Vector3.up, dir.normalized) * half;
                int v = verts.Count;
                verts.Add(a - nrm); verts.Add(a + nrm); verts.Add(b + nrm); verts.Add(b - nrm);
                tris.Add(v); tris.Add(v + 1); tris.Add(v + 2);
                tris.Add(v); tris.Add(v + 2); tris.Add(v + 3);
            }
            if (verts.Count < 4) return;
            var go = new GameObject("Road-" + (way.kind ?? "way"));
            go.transform.SetParent(parent, false);
            var mf = go.AddComponent<MeshFilter>();
            var mesh = new Mesh { name = "OsmRoad" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mf.sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = HaloMaterials.Asphalt;
        }

        static void FlatPoly(Transform parent, string name, int[] latE7, int[] lngE7, float y, Material mat)
        {
            if (!TryRing(latE7, lngE7, out var ring, out var lat, out var lng)) return;
            EnsureCcw(ring);
            var world = TwinWorld.LatLngToWorld(lat, lng);
            var local = new Vector3[ring.Length];
            for (int i = 0; i < ring.Length; i++)
            {
                local[i] = ring[i] - world;
                local[i].y = 0;
            }
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.position = world + Vector3.up * y;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = Cap(local, 0f);
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
        }

        static bool TryRing(int[] latE7, int[] lngE7, out Vector3[] ring, out double lat, out double lng)
        {
            ring = null; lat = 0; lng = 0;
            if (latE7 == null || lngE7 == null || latE7.Length < 2) return false;
            int n = Math.Min(latE7.Length, lngE7.Length);
            var pts = new List<Vector3>(n);
            double slat = 0, slng = 0;
            for (int i = 0; i < n; i++)
            {
                double la = latE7[i] / 1e7;
                double lo = lngE7[i] / 1e7;
                slat += la; slng += lo;
                pts.Add(TwinWorld.LatLngToWorld(la, lo));
            }
            if (pts.Count >= 4 && (pts[0] - pts[pts.Count - 1]).sqrMagnitude < 0.04f)
                pts.RemoveAt(pts.Count - 1);
            if (pts.Count < 2) return false;
            ring = pts.ToArray();
            lat = slat / n;
            lng = slng / n;
            return true;
        }

        static void EnsureCcw(Vector3[] ring)
        {
            double a = 0;
            for (int i = 0; i < ring.Length; i++)
            {
                var p = ring[i];
                var q = ring[(i + 1) % ring.Length];
                a += (p.x * q.z - q.x * p.z);
            }
            if (a < 0) Array.Reverse(ring);
        }

        static Material Skin(int i)
        {
            switch (i % 3)
            {
                case 0: return HaloMaterials.Brick;
                case 1: return HaloMaterials.Stucco;
                default: return HaloMaterials.BrickDeep;
            }
        }

        static GameObject MakeMass(string name, Transform parent, Vector3[] ring, float height, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = Extrude(ring, height);
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            var roof = new GameObject("Roof");
            roof.transform.SetParent(go.transform, false);
            var rmf = roof.AddComponent<MeshFilter>();
            rmf.sharedMesh = Cap(ring, height + 0.12f);
            var rmr = roof.AddComponent<MeshRenderer>();
            rmr.sharedMaterial = HaloMaterials.Roof;
            return go;
        }

        static void Label(Transform parent, int number, float y)
        {
            var go = new GameObject("Number");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0, y + 2.2f, 0);
            var tm = go.AddComponent<TextMesh>();
            tm.text = number.ToString();
            tm.fontSize = 64;
            tm.characterSize = 0.11f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.color = Color.white;
        }

        static Mesh Extrude(Vector3[] ring, float h)
        {
            var verts = new List<Vector3>();
            var tris = new List<int>();
            int n = ring.Length;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                var a = ring[i]; a.y = 0;
                var b = ring[j]; b.y = 0;
                var a2 = a; a2.y = h;
                var b2 = b; b2.y = h;
                int v = verts.Count;
                verts.Add(a); verts.Add(b); verts.Add(b2); verts.Add(a2);
                tris.Add(v); tris.Add(v + 1); tris.Add(v + 2);
                tris.Add(v); tris.Add(v + 2); tris.Add(v + 3);
            }
            var cap = Triangulate(ring);
            int baseV = verts.Count;
            foreach (var p in ring) verts.Add(new Vector3(p.x, h, p.z));
            foreach (var t in cap) tris.Add(baseV + t);
            var mesh = new Mesh { name = "OsmExtrude" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh Cap(Vector3[] ring, float y)
        {
            var verts = new List<Vector3>(ring.Length);
            foreach (var p in ring) verts.Add(new Vector3(p.x, y, p.z));
            var mesh = new Mesh { name = "OsmCap" };
            mesh.SetVertices(verts);
            mesh.SetTriangles(Triangulate(ring), 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static List<int> Triangulate(Vector3[] ring)
        {
            var idx = new List<int>(ring.Length);
            for (int i = 0; i < ring.Length; i++) idx.Add(i);
            var tris = new List<int>();
            int guard = 0;
            while (idx.Count > 3 && guard++ < 256)
            {
                bool clipped = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int ia = idx[(i + idx.Count - 1) % idx.Count];
                    int ib = idx[i];
                    int ic = idx[(i + 1) % idx.Count];
                    if (!IsEar(ring, idx, ia, ib, ic)) continue;
                    tris.Add(ia); tris.Add(ib); tris.Add(ic);
                    idx.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break;
            }
            if (idx.Count >= 3) { tris.Add(idx[0]); tris.Add(idx[1]); tris.Add(idx[2]); }
            return tris;
        }

        static bool IsEar(Vector3[] ring, List<int> idx, int ia, int ib, int ic)
        {
            var a = ring[ia]; var b = ring[ib]; var c = ring[ic];
            float cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
            if (cross <= 0.02f) return false;
            foreach (var i in idx)
            {
                if (i == ia || i == ib || i == ic) continue;
                if (PointInTri(ring[i], a, b, c)) return false;
            }
            return true;
        }

        static bool PointInTri(Vector3 p, Vector3 a, Vector3 b, Vector3 c)
        {
            float s = a.z * c.x - a.x * c.z + (c.z - a.z) * p.x + (a.x - c.x) * p.z;
            float t = a.x * b.z - a.z * b.x + (a.z - b.z) * p.x + (b.x - a.x) * p.z;
            if ((s < 0) != (t < 0) && s != 0 && t != 0) return false;
            float a2 = -b.z * c.x + a.z * (c.x - b.x) + a.x * (b.z - c.z) + b.x * c.z;
            return a2 < 0 ? (s <= 0 && s + t >= a2) : (s >= 0 && s + t <= a2);
        }

        static string ReadJson()
        {
            var ta = Resources.Load<TextAsset>("thornbury-osm-buildings");
            if (ta != null && !string.IsNullOrEmpty(ta.text)) return ta.text;
            var path = Path.Combine(Application.streamingAssetsPath, FileName);
            if (File.Exists(path)) return File.ReadAllText(path);
            path = Path.Combine(Application.dataPath, "StreamingAssets", FileName);
            if (File.Exists(path)) return File.ReadAllText(path);
            return null;
        }
    }
}
