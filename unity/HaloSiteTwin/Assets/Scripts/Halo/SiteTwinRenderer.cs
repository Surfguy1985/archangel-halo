using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Building-first plate: boxes = buildings, spheres = on-site crews, pulse densest.
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
        public int densestBuilding = -1;

        readonly Dictionary<int, GameObject> _buildings = new();
        readonly Dictionary<string, GameObject> _crews = new();
        readonly Dictionary<int, TextMesh> _labels = new();
        SiteCenter _origin;
        float _pulse;

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
                float s = 1f + 0.08f * Mathf.Sin(_pulse);
                var baseScale = BuildingScale();
                go.transform.localScale = baseScale * s;
            }
        }

        float WorldScale => config != null ? config.worldScale : 0.05f;
        float BuildingHeight => config != null ? config.buildingHeight : 8f;
        float MetersPerDeg => config != null ? config.metersPerDegreeLat : 111320f;

        Vector3 BuildingScale() => new Vector3(12f, BuildingHeight, 12f) * WorldScale * 20f;

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

        void Apply(TwinResponse twin)
        {
            if (twin?.site == null) return;
            _origin = twin.site;
            EnsureRoots();

            densestBuilding = -1;
            int bestCount = 0;
            // densest from presence counts
            var counts = new Dictionary<int, int>();
            if (twin.presence != null)
            {
                foreach (var p in twin.presence)
                {
                    if (!p.onSite || p.building <= 0) continue;
                    counts.TryGetValue(p.building, out var _cv); counts[p.building] = _cv + 1;
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

            if (twin.buildings != null)
            {
                foreach (var b in twin.buildings)
                {
                    if (!_buildings.TryGetValue(b.building, out var go) || !go)
                    {
                        go = buildingPrefab != null
                            ? Instantiate(buildingPrefab, buildingsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Cube);
                        go.name = b.label ?? $"Building {b.building}";
                        go.transform.SetParent(buildingsRoot, false);
                        go.transform.localScale = BuildingScale();
                        _buildings[b.building] = go;

                        // Number label
                        var labelGo = new GameObject($"Label-{b.building}");
                        labelGo.transform.SetParent(labelsRoot, false);
                        var tm = labelGo.AddComponent<TextMesh>();
                        tm.text = b.building.ToString();
                        tm.fontSize = 32;
                        tm.characterSize = 0.15f;
                        tm.anchor = TextAnchor.MiddleCenter;
                        tm.color = Color.white;
                        _labels[b.building] = tm;
                    }

                    var pos = LatLngToWorld(b.lat, b.lng);
                    go.transform.position = pos;
                    if (_labels.TryGetValue(b.building, out var lab) && lab)
                        lab.transform.position = pos + Vector3.up * (BuildingHeight * WorldScale * 14f);

                    var rend = go.GetComponent<Renderer>();
                    if (rend != null)
                    {
                        bool dense = b.building == densestBuilding;
                        counts.TryGetValue(b.building, out var _hc); bool hasCrew = _hc > 0;
                        rend.material.color = dense
                            ? new Color(0.22f, 0.74f, 0.98f)
                            : hasCrew
                                ? new Color(0.2f, 0.82f, 0.6f)
                                : new Color(0.25f, 0.3f, 0.38f);
                    }
                }
            }

            var seen = new HashSet<string>();
            if (twin.presence != null)
            {
                foreach (var c in twin.presence)
                {
                    if (!c.onSite) continue;
                    if (c.lat == 0 && c.lng == 0 && c.building <= 0) continue;
                    seen.Add(c.crewId);

                    if (!_crews.TryGetValue(c.crewId, out var go) || !go)
                    {
                        go = crewPrefab != null
                            ? Instantiate(crewPrefab, crewsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Sphere);
                        go.name = c.crewName ?? c.crewId;
                        go.transform.SetParent(crewsRoot, false);
                        go.transform.localScale = Vector3.one * (WorldScale * 30f);
                        var rend = go.GetComponent<Renderer>();
                        if (rend != null) rend.material.color = new Color(1f, 0.75f, 0.15f);
                        _crews[c.crewId] = go;
                    }

                    Vector3 pos;
                    if (c.lat != 0 || c.lng != 0)
                        pos = LatLngToWorld(c.lat, c.lng);
                    else if (c.building > 0 && _buildings.TryGetValue(c.building, out var bgo))
                        pos = bgo.transform.position + Vector3.right * 2f;
                    else
                        pos = Vector3.zero;
                    pos.y = BuildingHeight * WorldScale * 12f;
                    go.transform.position = pos;
                }
            }

            var remove = new List<string>();
            foreach (var kv in _crews)
            {
                if (!seen.Contains(kv.Key)) remove.Add(kv.Key);
            }
            foreach (var id in remove)
            {
                if (_crews.TryGetValue(id, out var go) && go) Destroy(go);
                _crews.Remove(id);
            }

            if (twin.summary != null)
                Debug.Log($"[Halo Twin] {twin.summary.headline}");
        }

        Vector3 LatLngToWorld(double lat, double lng)
        {
            double dLat = lat - _origin.lat;
            double dLng = lng - _origin.lng;
            float z = (float)(dLat * MetersPerDeg * WorldScale);
            float x = (float)(dLng * MetersPerDeg * Mathf.Cos((float)(_origin.lat * Mathf.Deg2Rad)) * WorldScale);
            return new Vector3(x, 0f, z);
        }

        public bool FocusBuilding(int building, Camera cam = null)
        {
            if (!_buildings.TryGetValue(building, out var go) || !go) return false;
            cam = cam != null ? cam : Camera.main;
            if (cam == null) return false;
            var target = go.transform.position + Vector3.up * 40f + Vector3.back * 55f;
            cam.transform.position = target;
            cam.transform.LookAt(go.transform.position);
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
