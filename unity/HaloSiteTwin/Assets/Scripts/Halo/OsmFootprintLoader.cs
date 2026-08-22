using System;
using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Loads real OSM building footprints from Halo API (Overpass bulk)
    /// and extrudes them as 3D meshes — no hand mapping, no abstract grid.
    ///
    /// Endpoint: GET {apiBase}/api/osm/buildings/thornbury
    /// </summary>
    public class OsmFootprintLoader : MonoBehaviour
    {
        public HaloConfig config;
        public Transform footprintsRoot;
        public float extrudeHeight = 12f;
        public Material buildingMaterial;
        public bool loadOnStart = true;
        public bool replaceGridWhenLoaded = true;

        [Header("Status")]
        public int loadedCount;
        public string lastError;
        public bool isLoaded;

        readonly List<GameObject> _meshes = new();

        void Start()
        {
            if (loadOnStart) StartCoroutine(Load());
        }

        [ContextMenu("Reload OSM Footprints")]
        public void Reload() => StartCoroutine(Load());

        IEnumerator Load()
        {
            if (config == null)
            {
                lastError = "No HaloConfig";
                Debug.LogError("[Halo OSM] " + lastError);
                yield break;
            }

            string url = $"{config.apiBase.TrimEnd('/')}/api/osm/buildings/thornbury";
            Debug.Log("[Halo OSM] Fetching " + url);

            using var req = UnityWebRequest.Get(url);
            req.timeout = 60;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                lastError = $"{req.error} HTTP {req.responseCode}";
                Debug.LogError("[Halo OSM] " + lastError);
                yield break;
            }

            string json = req.downloadHandler.text;
            // JsonUtility cannot parse nested arrays well — use minimal extract
            var buildings = ParseBuildings(json);
            if (buildings.Count == 0)
            {
                lastError = "0 buildings parsed — check API / Overpass";
                Debug.LogWarning("[Halo OSM] " + lastError);
                yield break;
            }

            EnsureRoot();
            ClearMeshes();

            // Origin = first centroid or site center
            double originLat = buildings[0].centroidLat;
            double originLng = buildings[0].centroidLng;
            float mPerDegLat = 111320f;
            float mPerDegLng = 111320f * Mathf.Cos((float)(originLat * Mathf.Deg2Rad));
            float scale = config != null ? config.worldScale : 0.05f;

            int i = 0;
            foreach (var b in buildings)
            {
                if (b.ring == null || b.ring.Count < 3) continue;
                var verts2d = new List<Vector2>();
                foreach (var pt in b.ring)
                {
                    float x = (float)((pt.lng - originLng) * mPerDegLng * scale);
                    float z = (float)((pt.lat - originLat) * mPerDegLat * scale);
                    verts2d.Add(new Vector2(x, z));
                }
                // Drop closing duplicate
                if (verts2d.Count > 1 && Vector2.Distance(verts2d[0], verts2d[verts2d.Count - 1]) < 0.01f)
                    verts2d.RemoveAt(verts2d.Count - 1);

                float h = b.levels > 0 ? b.levels * 3.2f : extrudeHeight;
                h *= scale * 20f; // match grid building scale roughly

                var go = CreateExtrudedBuilding(verts2d, h, b.name ?? $"OSM-{b.osmId}");
                if (go != null)
                {
                    go.transform.SetParent(footprintsRoot, false);
                    _meshes.Add(go);
                    i++;
                }
            }

            loadedCount = i;
            isLoaded = true;
            lastError = null;
            Debug.Log($"[Halo OSM] Loaded {i} footprints from Overpass via Halo API");

            if (replaceGridWhenLoaded)
            {
                var grid = FindObjectOfType<SiteTwinRenderer>();
                if (grid != null && grid.buildingsRoot != null)
                    grid.buildingsRoot.gameObject.SetActive(false);
            }

            FitCamera();
        }

        void EnsureRoot()
        {
            if (footprintsRoot == null)
            {
                var go = new GameObject("OSM_Footprints");
                go.transform.SetParent(transform, false);
                footprintsRoot = go.transform;
            }
        }

        void ClearMeshes()
        {
            foreach (var g in _meshes)
                if (g) Destroy(g);
            _meshes.Clear();
            if (footprintsRoot != null)
            {
                for (int i = footprintsRoot.childCount - 1; i >= 0; i--)
                    Destroy(footprintsRoot.GetChild(i).gameObject);
            }
        }

        GameObject CreateExtrudedBuilding(List<Vector2> ring, float height, string name)
        {
            if (ring.Count < 3) return null;

            // Triangulate bottom (fan — fine for convex-ish building outlines)
            var verts = new List<Vector3>();
            var tris = new List<int>();
            int n = ring.Count;

            // Bottom
            for (int i = 0; i < n; i++)
                verts.Add(new Vector3(ring[i].x, 0f, ring[i].y));
            // Top
            for (int i = 0; i < n; i++)
                verts.Add(new Vector3(ring[i].x, height, ring[i].y));

            // Bottom face (fan, downward-facing flipped)
            for (int i = 1; i < n - 1; i++)
            {
                tris.Add(0);
                tris.Add(i + 1);
                tris.Add(i);
            }
            // Top face
            for (int i = 1; i < n - 1; i++)
            {
                tris.Add(n);
                tris.Add(n + i);
                tris.Add(n + i + 1);
            }
            // Walls
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                int b0 = i, b1 = j, t0 = n + i, t1 = n + j;
                tris.Add(b0); tris.Add(t0); tris.Add(b1);
                tris.Add(b1); tris.Add(t0); tris.Add(t1);
            }

            var mesh = new Mesh { name = name };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();

            var go = new GameObject(name);
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            if (buildingMaterial != null)
                mr.sharedMaterial = buildingMaterial;
            else
            {
                var mat = new Material(Shader.Find("Standard") ?? Shader.Find("Diffuse"));
                mat.color = new Color(0.32f, 0.38f, 0.48f);
                mr.sharedMaterial = mat;
            }

            // Label
            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(go.transform, false);
            var center = mesh.bounds.center;
            labelGo.transform.localPosition = center + Vector3.up * (height * 0.5f + 1f);
            var tm = labelGo.AddComponent<TextMesh>();
            tm.text = Truncate(name, 18);
            tm.fontSize = 32;
            tm.characterSize = 0.25f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = Color.white;

            return go;
        }

        static string Truncate(string s, int max) =>
            string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s.Substring(0, max - 1) + "…");

        void FitCamera()
        {
            if (_meshes.Count == 0 || Camera.main == null) return;
            Bounds bounds = new Bounds(_meshes[0].transform.position, Vector3.one);
            foreach (var g in _meshes)
            {
                var r = g.GetComponent<Renderer>();
                if (r) bounds.Encapsulate(r.bounds);
            }
            float size = Mathf.Max(bounds.size.x, bounds.size.z, 30f);
            var cam = Camera.main;
            cam.transform.position = bounds.center + new Vector3(0f, size * 0.9f, -size * 0.8f);
            cam.transform.LookAt(bounds.center);
            cam.farClipPlane = Mathf.Max(cam.farClipPlane, size * 5f);
        }

        // --- Minimal JSON parse for buildings array (avoids Newtonsoft dependency) ---

        struct Bldg
        {
            public long osmId;
            public string name;
            public int levels;
            public double centroidLat, centroidLng;
            public List<Pt> ring;
        }
        struct Pt { public double lng, lat; }

        static List<Bldg> ParseBuildings(string json)
        {
            var list = new List<Bldg>();
            // Split roughly on building objects inside "buildings":[...]
            var m = Regex.Match(json, "\"buildings\"\\s*:\\s*\\[(.*)\\]", RegexOptions.Singleline);
            if (!m.Success) return list;
            string arr = m.Groups[1].Value;

            // Each object starts with {
            int depth = 0, start = -1;
            for (int i = 0; i < arr.Length; i++)
            {
                if (arr[i] == '{')
                {
                    if (depth == 0) start = i;
                    depth++;
                }
                else if (arr[i] == '}')
                {
                    depth--;
                    if (depth == 0 && start >= 0)
                    {
                        var obj = arr.Substring(start, i - start + 1);
                        var b = ParseOne(obj);
                        if (b.ring != null && b.ring.Count >= 3) list.Add(b);
                        start = -1;
                    }
                }
            }
            return list;
        }

        static Bldg ParseOne(string obj)
        {
            var b = new Bldg { ring = new List<Pt>(), levels = 0 };
            var idm = Regex.Match(obj, "\"osmId\"\\s*:\\s*(\\d+)");
            if (idm.Success) long.TryParse(idm.Groups[1].Value, out b.osmId);
            var nm = Regex.Match(obj, "\"name\"\\s*:\\s*\"([^\"]*)\"");
            if (nm.Success) b.name = nm.Groups[1].Value;
            else b.name = $"way/{b.osmId}";
            var lm = Regex.Match(obj, "\"levels\"\\s*:\\s*(\\d+)");
            if (lm.Success) int.TryParse(lm.Groups[1].Value, out b.levels);
            var clat = Regex.Match(obj, "\"centroid\"\\s*:\\s*\\{[^}]*\"lat\"\\s*:\\s*([\\-0-9.]+)");
            var clng = Regex.Match(obj, "\"centroid\"\\s*:\\s*\\{[^}]*\"lng\"\\s*:\\s*([\\-0-9.]+)");
            if (clat.Success) double.TryParse(clat.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out b.centroidLat);
            if (clng.Success) double.TryParse(clng.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out b.centroidLng);

            // ring: [[lng,lat],[lng,lat],...]
            var rm = Regex.Match(obj, "\"ring\"\\s*:\\s*\\[(.*)\\]", RegexOptions.Singleline);
            if (rm.Success)
            {
                foreach (Match pt in Regex.Matches(rm.Groups[1].Value, "\\[\\s*([\\-0-9.]+)\\s*,\\s*([\\-0-9.]+)\\s*\\]"))
                {
                    double.TryParse(pt.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double lng);
                    double.TryParse(pt.Groups[2].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double lat);
                    b.ring.Add(new Pt { lng = lng, lat = lat });
                }
            }
            return b;
        }
    }
}
