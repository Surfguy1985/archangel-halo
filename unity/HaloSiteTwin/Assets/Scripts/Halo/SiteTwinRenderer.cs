using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Building-first plate: boxes for buildings, spheres for on-site crews.
    /// Lat/lng projected onto a flat plane around site center.
    /// </summary>
    public class SiteTwinRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public Transform buildingsRoot;
        public Transform crewsRoot;
        public GameObject buildingPrefab; // optional; else Primitive Cube
        public GameObject crewPrefab;     // optional; else Primitive Sphere
        public float metersPerDegreeLat = 111320f;
        public float worldScale = 0.05f; // shrink site into view
        public float buildingHeight = 8f;

        readonly Dictionary<int, GameObject> _buildings = new();
        readonly Dictionary<string, GameObject> _crews = new();
        SiteCenter _origin;

        void OnEnable()
        {
            if (client != null) client.OnTwinUpdated += Apply;
        }

        void OnDisable()
        {
            if (client != null) client.OnTwinUpdated -= Apply;
        }

        void Apply(TwinResponse twin)
        {
            if (twin?.site == null) return;
            _origin = twin.site;

            if (buildingsRoot == null)
            {
                var go = new GameObject("Buildings");
                go.transform.SetParent(transform);
                buildingsRoot = go.transform;
            }
            if (crewsRoot == null)
            {
                var go = new GameObject("Crews");
                go.transform.SetParent(transform);
                crewsRoot = go.transform;
            }

            if (twin.buildings != null)
            {
                foreach (var b in twin.buildings)
                {
                    if (!_buildings.TryGetValue(b.building, out var go))
                    {
                        go = buildingPrefab != null
                            ? Instantiate(buildingPrefab, buildingsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Cube);
                        go.name = b.label;
                        go.transform.SetParent(buildingsRoot, false);
                        go.transform.localScale = new Vector3(12f, buildingHeight, 12f) * worldScale * 20f;
                        _buildings[b.building] = go;
                    }
                    go.transform.position = LatLngToWorld(b.lat, b.lng);
                }
            }

            // Clear missing crews
            var seen = new HashSet<string>();
            if (twin.presence != null)
            {
                foreach (var c in twin.presence)
                {
                    if (!c.onSite || c.lat == 0 && c.lng == 0) continue;
                    seen.Add(c.crewId);
                    if (!_crews.TryGetValue(c.crewId, out var go))
                    {
                        go = crewPrefab != null
                            ? Instantiate(crewPrefab, crewsRoot)
                            : GameObject.CreatePrimitive(PrimitiveType.Sphere);
                        go.name = c.crewName;
                        go.transform.SetParent(crewsRoot, false);
                        go.transform.localScale = Vector3.one * (worldScale * 30f);
                        _crews[c.crewId] = go;
                    }
                    var pos = LatLngToWorld(c.lat, c.lng);
                    pos.y = buildingHeight * worldScale * 12f;
                    go.transform.position = pos;
                }
            }

            var toRemove = new List<string>();
            foreach (var kv in _crews)
            {
                if (!seen.Contains(kv.Key)) toRemove.Add(kv.Key);
            }
            foreach (var id in toRemove)
            {
                if (_crews.TryGetValue(id, out var go) && go != null) Destroy(go);
                _crews.Remove(id);
            }

            if (twin.summary != null)
                Debug.Log($"[Halo Twin] {twin.summary.headline}");
        }

        Vector3 LatLngToWorld(double lat, double lng)
        {
            double dLat = lat - _origin.lat;
            double dLng = lng - _origin.lng;
            float z = (float)(dLat * metersPerDegreeLat * worldScale);
            float x = (float)(dLng * metersPerDegreeLat * Mathf.Cos((float)(_origin.lat * Mathf.Deg2Rad)) * worldScale);
            return new Vector3(x, 0f, z);
        }

        /// <summary>MCP / external: focus camera on building number.</summary>
        public bool FocusBuilding(int building, Camera cam = null)
        {
            if (!_buildings.TryGetValue(building, out var go) || go == null) return false;
            cam = cam != null ? cam : Camera.main;
            if (cam == null) return false;
            var target = go.transform.position + Vector3.up * 40f + Vector3.back * 50f;
            cam.transform.position = target;
            cam.transform.LookAt(go.transform.position);
            return true;
        }
    }
}
