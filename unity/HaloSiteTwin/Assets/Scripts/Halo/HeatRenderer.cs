using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    public class HeatRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public HaloConfig config;
        public Transform heatRoot;
        readonly List<GameObject> _cells = new();
        SiteCenter _origin;

        void OnEnable()
        {
            if (client != null) client.OnTwinUpdated += Apply;
        }

        void OnDisable()
        {
            if (client != null) client.OnTwinUpdated -= Apply;
        }

        float WorldScale => config != null ? config.worldScale : 0.05f;
        float MetersPerDeg => config != null ? config.metersPerDegreeLat : 111320f;

        void Apply(TwinResponse twin)
        {
            if (twin?.site == null || twin.heat == null) return;
            _origin = twin.site;
            if (heatRoot == null)
            {
                var go = new GameObject("Heat");
                go.transform.SetParent(transform, false);
                heatRoot = go.transform;
            }
            foreach (var c in _cells)
                if (c) Destroy(c);
            _cells.Clear();

            foreach (var h in twin.heat)
            {
                if (h.weight < 1) continue;
                var cell = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cell.name = $"heat-w{h.weight}";
                cell.transform.SetParent(heatRoot, false);
                var pos = LatLngToWorld(h.lat, h.lng);
                pos.y = 0.15f;
                cell.transform.position = pos;
                float s = Mathf.Clamp(h.weight, 1, 20) * WorldScale * 8f;
                cell.transform.localScale = new Vector3(s, 0.12f, s);
                var r = cell.GetComponent<Renderer>();
                if (r != null)
                    r.material.color = new Color(1f, 0.35f, 0.12f, 0.4f);
                var col = cell.GetComponent<Collider>();
                if (col) Destroy(col);
                _cells.Add(cell);
            }
        }

        Vector3 LatLngToWorld(double lat, double lng)
        {
            double dLat = lat - _origin.lat;
            double dLng = lng - _origin.lng;
            float z = (float)(dLat * MetersPerDeg * WorldScale);
            float x = (float)(dLng * MetersPerDeg * Mathf.Cos((float)(_origin.lat * Mathf.Deg2Rad)) * WorldScale);
            return new Vector3(x, 0f, z);
        }
    }
}
