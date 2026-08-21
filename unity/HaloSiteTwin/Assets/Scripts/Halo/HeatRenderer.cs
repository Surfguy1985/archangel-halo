using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    public class HeatRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public Transform heatRoot;
        public float worldScale = 0.05f;
        public float metersPerDegreeLat = 111320f;
        SiteCenter _origin;
        readonly List<GameObject> _cells = new();

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
            if (twin?.site == null || twin.heat == null) return;
            _origin = twin.site;
            if (heatRoot == null)
            {
                var go = new GameObject("Heat");
                go.transform.SetParent(transform);
                heatRoot = go.transform;
            }
            foreach (var c in _cells) if (c) Destroy(c);
            _cells.Clear();
            foreach (var h in twin.heat)
            {
                if (h.weight < 1) continue;
                var cell = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                cell.name = $"heat-{h.weight}";
                cell.transform.SetParent(heatRoot, false);
                var pos = LatLngToWorld(h.lat, h.lng);
                pos.y = 0.2f;
                cell.transform.position = pos;
                float s = Mathf.Clamp(h.weight, 1, 20) * worldScale * 8f;
                cell.transform.localScale = new Vector3(s, 0.15f, s);
                var r = cell.GetComponent<Renderer>();
                if (r != null)
                {
                    r.material.color = new Color(1f, 0.3f, 0.1f, 0.35f);
                }
                _cells.Add(cell);
            }
        }

        Vector3 LatLngToWorld(double lat, double lng)
        {
            double dLat = lat - _origin.lat;
            double dLng = lng - _origin.lng;
            float z = (float)(dLat * metersPerDegreeLat * worldScale);
            float x = (float)(dLng * metersPerDegreeLat * Mathf.Cos((float)(_origin.lat * Mathf.Deg2Rad)) * worldScale);
            return new Vector3(x, 0f, z);
        }
    }
}
