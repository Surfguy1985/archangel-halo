using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Loads /api/osm/buildings/matched and extrudes Building 1–20 footprints.
    /// Prefer over raw Overpass when Halo centroids exist.
    /// </summary>
    public class OsmMatchedLoader : MonoBehaviour
    {
        public HaloConfig config;
        public Transform root;
        public SiteTwinRenderer gridToHide;
        public bool loadOnStart = true;
        public float worldScale = 0.05f;

        void Start()
        {
            if (loadOnStart) StartCoroutine(Load());
        }

        [ContextMenu("Reload Matched OSM")]
        public void Reload() => StartCoroutine(Load());

        IEnumerator Load()
        {
            if (config == null) yield break;
            // Prefer plate footprints (one call has everything) else matched endpoint
            string plateUrl = $"{config.apiBase.TrimEnd('/')}/api/properties/{config.propertyId}/building-ops";
            using var req = UnityWebRequest.Get(plateUrl);
            req.timeout = 60;
            yield return req.SendWebRequest();
            string json = req.result == UnityWebRequest.Result.Success ? req.downloadHandler.text : null;
            if (string.IsNullOrEmpty(json) || !json.Contains("\"footprints\""))
            {
                using var req2 = UnityWebRequest.Get($"{config.apiBase.TrimEnd('/')}/api/osm/buildings/matched");
                req2.timeout = 60;
                yield return req2.SendWebRequest();
                if (req2.result != UnityWebRequest.Result.Success)
                {
                    Debug.LogError("[Halo matched] " + req2.error);
                    yield break;
                }
                json = req2.downloadHandler.text;
            }

            if (root == null)
            {
                var go = new GameObject("OSM_Matched");
                go.transform.SetParent(transform, false);
                root = go.transform;
            }
            for (int i = root.childCount - 1; i >= 0; i--)
                Destroy(root.GetChild(i).gameObject);

            var items = ParseMatched(json);
            if (items.Count == 0)
            {
                Debug.LogWarning("[Halo matched] 0 footprints");
                yield break;
            }

            double oLat = items[0].lat, oLng = items[0].lng;
            float mLat = 111320f;
            float mLng = 111320f * Mathf.Cos((float)(oLat * Mathf.Deg2Rad));
            float scale = config.worldScale > 0 ? config.worldScale : worldScale;

            foreach (var it in items)
            {
                if (it.ring.Count < 3) continue;
                var ring = new List<Vector2>();
                foreach (var p in it.ring)
                {
                    float x = (float)((p.lng - oLng) * mLng * scale);
                    float z = (float)((p.lat - oLat) * mLat * scale);
                    ring.Add(new Vector2(x, z));
                }
                if (ring.Count > 1 && Vector2.Distance(ring[0], ring[ring.Count - 1]) < 0.02f)
                    ring.RemoveAt(ring.Count - 1);

                float h = (it.levels > 0 ? it.levels * 3.2f : 10f) * scale * 18f;
                var meshGo = Extrude(ring, h, $"Building_{it.building}");
                if (meshGo != null)
                {
                    meshGo.transform.SetParent(root, false);
                    var label = new GameObject("Label");
                    label.transform.SetParent(meshGo.transform, false);
                    label.transform.localPosition = Vector3.up * (h + 1.5f);
                    var tm = label.AddComponent<TextMesh>();
                    tm.text = it.building.ToString();
                    tm.fontSize = 40;
                    tm.characterSize = 0.3f;
                    tm.anchor = TextAnchor.MiddleCenter;
                    tm.color = Color.white;
                }
            }

            if (gridToHide != null && gridToHide.buildingsRoot != null)
                gridToHide.buildingsRoot.gameObject.SetActive(false);

            Debug.Log($"[Halo matched] extruded {items.Count} buildings");
            FitCamera();
        }

        void FitCamera()
        {
            if (root == null || root.childCount == 0 || Camera.main == null) return;
            var b = new Bounds(root.GetChild(0).position, Vector3.one * 5f);
            for (int i = 0; i < root.childCount; i++)
            {
                var r = root.GetChild(i).GetComponent<Renderer>();
                if (r) b.Encapsulate(r.bounds);
            }
            float size = Mathf.Max(b.size.x, b.size.z, 40f);
            Camera.main.transform.position = b.center + new Vector3(0, size * 0.9f, -size * 0.75f);
            Camera.main.transform.LookAt(b.center);
        }

        static GameObject Extrude(List<Vector2> ring, float height, string name)
        {
            int n = ring.Count;
            if (n < 3) return null;
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int i = 0; i < n; i++) verts.Add(new Vector3(ring[i].x, 0, ring[i].y));
            for (int i = 0; i < n; i++) verts.Add(new Vector3(ring[i].x, height, ring[i].y));
            for (int i = 1; i < n - 1; i++) { tris.Add(0); tris.Add(i + 1); tris.Add(i); }
            for (int i = 1; i < n - 1; i++) { tris.Add(n); tris.Add(n + i); tris.Add(n + i + 1); }
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                tris.Add(i); tris.Add(n + i); tris.Add(j);
                tris.Add(j); tris.Add(n + i); tris.Add(n + j);
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            var go = new GameObject(name);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            var mat = new Material(Shader.Find("Standard") ?? Shader.Find("Diffuse"));
            mat.color = new Color(0.28f, 0.36f, 0.48f);
            mr.sharedMaterial = mat;
            return go;
        }

        struct Item
        {
            public int building, levels;
            public double lat, lng;
            public List<Pt> ring;
        }
        struct Pt { public double lng, lat; }

        static List<Item> ParseMatched(string json)
        {
            var list = new List<Item>();
            // Work on matched array or footprints array
            var m = Regex.Match(json, "\"(?:matched|footprints)\"\\s*:\\s*\\[(.*)\\]", RegexOptions.Singleline);
            if (!m.Success) return list;
            string arr = m.Groups[1].Value;
            int depth = 0, start = -1;
            for (int i = 0; i < arr.Length; i++)
            {
                if (arr[i] == '{') { if (depth == 0) start = i; depth++; }
                else if (arr[i] == '}')
                {
                    depth--;
                    if (depth == 0 && start >= 0)
                    {
                        var obj = arr.Substring(start, i - start + 1);
                        var it = ParseOne(obj);
                        if (it.building > 0 && it.ring.Count >= 3) list.Add(it);
                        start = -1;
                    }
                }
            }
            return list;
        }

        static Item ParseOne(string obj)
        {
            var it = new Item { ring = new List<Pt>() };
            var bm = Regex.Match(obj, "\"building\"\\s*:\\s*(\\d+)");
            if (bm.Success) int.TryParse(bm.Groups[1].Value, out it.building);
            var lm = Regex.Match(obj, "\"levels\"\\s*:\\s*(\\d+)");
            if (lm.Success) int.TryParse(lm.Groups[1].Value, out it.levels);
            var clat = Regex.Match(obj, "\"centroid\"\\s*:\\s*\\{[^}]*\"lat\"\\s*:\\s*([\\-0-9.]+)");
            var clng = Regex.Match(obj, "\"centroid\"\\s*:\\s*\\{[^}]*\"lng\"\\s*:\\s*([\\-0-9.]+)");
            if (clat.Success) double.TryParse(clat.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out it.lat);
            if (clng.Success) double.TryParse(clng.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out it.lng);
            var rm = Regex.Match(obj, "\"ring\"\\s*:\\s*\\[(.*)\\]", RegexOptions.Singleline);
            if (rm.Success)
            {
                foreach (Match pt in Regex.Matches(rm.Groups[1].Value, "\\[\\s*([\\-0-9.]+)\\s*,\\s*([\\-0-9.]+)\\s*\\]"))
                {
                    double.TryParse(pt.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out double lng);
                    double.TryParse(pt.Groups[2].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out double lat);
                    it.ring.Add(new Pt { lng = lng, lat = lat });
                }
            }
            return it;
        }
    }
}
