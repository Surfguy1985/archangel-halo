using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Building-first plate. Layout: Grid (see all 20) or Geo (true lat/lng).
    /// Auto-frames camera so every building is visible.
    /// </summary>
    public class SiteTwinRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public HaloConfig config;
        public Transform buildingsRoot;
        public Transform crewsRoot;
        public Transform labelsRoot;
        public GameObject buildingPrefab;
        public GameObject crewPrefab;

        [Tooltip("Grid = all 20 visible in a neat layout. Geo = real GPS positions (may need high camera).")]
        public bool useGridLayout = true;

        public float gridSpacing = 18f;
        public int densestBuilding = -1;

        readonly Dictionary<int, GameObject> _buildings = new();
        readonly Dictionary<string, GameObject> _crews = new();
        readonly Dictionary<int, TextMesh> _labels = new();
        readonly Dictionary<int, Vector3> _buildingPos = new();
        SiteCenter _origin;
        float _pulse;
        bool _framedOnce;

        void OnEnable()
        {
            if (client != null) client.OnTwinUpdated += Apply;
        }

        void OnDisable()
        {
            if (client != null) client.OnTwinUpdated -= Apply;
        }

        void Update()
        {
            _pulse += Time.deltaTime * 3f;
            if (densestBuilding > 0 && _buildings.TryGetValue(densestBuilding, out var go) && go)
            {
                float s = 1f + 0.1f * Mathf.Sin(_pulse);
                go.transform.localScale = BuildingScale() * s;
            }
        }

        float WorldScale => config != null ? config.worldScale : 0.05f;
        float BuildingHeight => config != null ? config.buildingHeight : 8f;
        float MetersPerDeg => config != null ? config.metersPerDegreeLat : 111320f;

        Vector3 BuildingScale() => new Vector3(10f, BuildingHeight, 10f) * (useGridLayout ? 1f : WorldScale * 20f);

        void EnsureRoots()
        {
            if (buildingsRoot == null)
            {
                var go = new GameObject("Buildings");
                go.transform.SetParent(transform, false);
                buildingsRoot = go.transform;
            }
            if (crewsRoot == null)
            {
                var go = new GameObject("Crews");
                go.transform.SetParent(transform, false);
                crewsRoot = go.transform;
            }
            if (labelsRoot == null)
            {
                var go = new GameObject("Labels");
                go.transform.SetParent(transform, false);
                labelsRoot = go.transform;
            }
        }

        Vector3 GridPos(int building)
        {
            // 5 x 4 grid for buildings 1–20
            int idx = Mathf.Max(0, building - 1);
            int col = idx % 5;
            int row = idx / 5;
            float x = (col - 2) * gridSpacing;
            float z = (row - 1.5f) * gridSpacing;
            return new Vector3(x, 0f, z);
        }

        Vector3 GeoPos(double lat, double lng)
        {
            double dLat = lat - _origin.lat;
            double dLng = lng - _origin.lng;
            float z = (float)(dLat * MetersPerDeg * WorldScale);
            float x = (float)(dLng * MetersPerDeg * Mathf.Cos((float)(_origin.lat * Mathf.Deg2Rad)) * WorldScale);
            return new Vector3(x, 0f, z);
        }

        void Apply(TwinResponse twin)
        {
            if (twin?.site == null) return;
            _origin = twin.site;
            EnsureRoots();

            densestBuilding = -1;
            int bestCount = 0;
            var counts = new Dictionary<int, int>();
            if (twin.presence != null)
            {
                foreach (var p in twin.presence)
                {
                    if (!p.onSite || p.building <= 0) continue;
                    counts.TryGetValue(p.building, out var cv);
                    counts[p.building] = cv + 1;
                }
            }
            foreach (var kv in counts)
            {
                if (kv.Value > bestCount)
                {
                    bestCount = kv.Value;
                    densestBuilding = kv.Key;
                }
            }

            int built = 0;
            if (twin.buildings != null)
            {
                foreach (var b in twin.buildings)
                {
                    if (!_buildings.TryGetValue(b.building, out var go) || !go)
                    {
                        go = buildingPrefab != null
                            ? Instantiate(buildingPrefab, buildingsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Cube);
                        go.name = $"Building_{b.building}";
                        go.transform.SetParent(buildingsRoot, false);
                        go.transform.localScale = BuildingScale();
                        _buildings[b.building] = go;

                        var labelGo = new GameObject($"Label_{b.building}");
                        labelGo.transform.SetParent(labelsRoot, false);
                        var tm = labelGo.AddComponent<TextMesh>();
                        tm.text = b.building.ToString();
                        tm.fontSize = 48;
                        tm.characterSize = 0.35f;
                        tm.anchor = TextAnchor.MiddleCenter;
                        tm.alignment = TextAlignment.Center;
                        tm.color = Color.white;
                        tm.fontStyle = FontStyle.Bold;
                        _labels[b.building] = tm;
                    }

                    Vector3 pos = useGridLayout
                        ? GridPos(b.building)
                        : GeoPos(b.lat, b.lng);
                    _buildingPos[b.building] = pos;
                    go.transform.position = pos;
                    go.transform.localScale = BuildingScale();

                    if (_labels.TryGetValue(b.building, out var lab) && lab)
                    {
                        lab.transform.position = pos + Vector3.up * (BuildingScale().y * 0.65f + 1.5f);
                        // Face camera
                        if (Camera.main != null)
                            lab.transform.rotation = Quaternion.LookRotation(
                                lab.transform.position - Camera.main.transform.position);
                    }

                    var rend = go.GetComponent<Renderer>();
                    if (rend != null)
                    {
                        counts.TryGetValue(b.building, out var hc);
                        bool dense = b.building == densestBuilding;
                        bool hasCrew = hc > 0;
                        rend.material.color = dense
                            ? new Color(0.2f, 0.75f, 1f)
                            : hasCrew
                                ? new Color(0.2f, 0.85f, 0.55f)
                                : new Color(0.35f, 0.4f, 0.5f);
                    }
                    built++;
                }
            }

            // Crews
            var seen = new HashSet<string>();
            if (twin.presence != null)
            {
                foreach (var c in twin.presence)
                {
                    if (!c.onSite) continue;
                    seen.Add(c.crewId);
                    if (!_crews.TryGetValue(c.crewId, out var go) || !go)
                    {
                        go = crewPrefab != null
                            ? Instantiate(crewPrefab, crewsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Sphere);
                        go.name = c.crewName ?? c.crewId;
                        go.transform.SetParent(crewsRoot, false);
                        go.transform.localScale = Vector3.one * 3.5f;
                        var rend = go.GetComponent<Renderer>();
                        if (rend != null) rend.material.color = new Color(1f, 0.8f, 0.15f);
                        _crews[c.crewId] = go;
                    }

                    Vector3 pos;
                    if (c.building > 0 && _buildingPos.TryGetValue(c.building, out var bp))
                        pos = bp + Vector3.up * (BuildingScale().y + 2f) + Vector3.right * 3f;
                    else if (!useGridLayout && (c.lat != 0 || c.lng != 0))
                        pos = GeoPos(c.lat, c.lng) + Vector3.up * 8f;
                    else
                        pos = Vector3.up * 8f;
                    go.transform.position = pos;
                }
            }

            var remove = new List<string>();
            foreach (var kv in _crews)
                if (!seen.Contains(kv.Key)) remove.Add(kv.Key);
            foreach (var id in remove)
            {
                if (_crews.TryGetValue(id, out var go) && go) Destroy(go);
                _crews.Remove(id);
            }

            Debug.Log($"[Halo Twin] buildings visible={built}/{(twin.buildings != null ? twin.buildings.Count : 0)} densest={densestBuilding} layout={(useGridLayout ? "GRID" : "GEO")}");

            if (!_framedOnce && built > 0)
            {
                _framedOnce = true;
                FitCameraToAll();
            }
        }

        /// <summary>Frame every building in the Main Camera view.</summary>
        public void FitCameraToAll()
        {
            if (_buildingPos.Count == 0) return;
            var cam = Camera.main;
            if (cam == null) return;

            Bounds bounds = new Bounds(Vector3.zero, Vector3.zero);
            bool first = true;
            foreach (var pos in _buildingPos.Values)
            {
                if (first) { bounds = new Bounds(pos, BuildingScale()); first = false; }
                else bounds.Encapsulate(new Bounds(pos, BuildingScale()));
            }

            Vector3 center = bounds.center;
            float size = Mathf.Max(bounds.size.x, bounds.size.z, 40f);
            float dist = size * 1.15f;
            cam.transform.position = center + new Vector3(0f, dist * 0.85f, -dist * 0.75f);
            cam.transform.LookAt(center + Vector3.up * 2f);
            cam.farClipPlane = Mathf.Max(cam.farClipPlane, dist * 4f);
            Debug.Log($"[Halo] Camera fit all { _buildingPos.Count } buildings size={size:F0}");
        }

        public bool FocusBuilding(int building, Camera cam = null)
        {
            if (!_buildings.TryGetValue(building, out var go) || !go) return false;
            cam = cam != null ? cam : Camera.main;
            if (cam == null) return false;
            var p = go.transform.position;
            cam.transform.position = p + new Vector3(0f, 35f, -40f);
            cam.transform.LookAt(p);
            densestBuilding = building;
            return true;
        }

        public bool FocusDensest(Camera cam = null)
        {
            if (densestBuilding <= 0) return false;
            return FocusBuilding(densestBuilding, cam);
        }
    }
}
