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
            if (twin?.heat == null) return;
            if (config != null && config.useGooglePhotoreal && HaloLocalSecrets.HasKey(config))
                return;
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
                var pos = TwinWorld.LatLngToWorld(h.lat, h.lng);
                pos.y = 0.2f;
                cell.transform.position = pos;
                float s = Mathf.Clamp(h.weight, 1, 16) * 1.8f;
                cell.transform.localScale = new Vector3(s, 0.08f, s);
                var r = cell.GetComponent<Renderer>();
                if (r != null)
                {
                    var mat = HaloMaterials.Make(new Color(1f, 0.38f, 0.12f, 0.45f), 0.2f);
                    r.sharedMaterial = mat;
                }
                var col = cell.GetComponent<Collider>();
                if (col) Destroy(col);
                _cells.Add(cell);
            }
        }
    }
}
