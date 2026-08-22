using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Priorities 3–5 for Unity: money tint, turn radar, photo billboards, selection.
    /// </summary>
    public class SiteTwinLayersRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public SiteTwinRenderer siteRenderer;
        public Transform radarRoot;
        public Transform billboardRoot;
        public float markerScale = 2.5f;

        int _selectedBuilding;

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
            if (twin == null) return;
            ApplyMoneyTint(twin);
            ApplyTurnRadar(twin);
            ApplyBillboards(twin);
            if (twin.selection != null && twin.selection.building > 0)
            {
                _selectedBuilding = twin.selection.building;
                siteRenderer?.FocusBuilding(_selectedBuilding);
            }
        }

        void ApplyMoneyTint(TwinResponse twin)
        {
            if (siteRenderer?.buildingsRoot == null || twin.buildings == null) return;
            var risk = new Dictionary<int, string>();
            foreach (var b in twin.buildings)
                if (!string.IsNullOrEmpty(b.risk)) risk[b.building] = b.risk;

            for (int i = 0; i < siteRenderer.buildingsRoot.childCount; i++)
            {
                var child = siteRenderer.buildingsRoot.GetChild(i);
                // name Building_N
                var parts = child.name.Split('_');
                if (parts.Length < 2 || !int.TryParse(parts[parts.Length - 1], out int bnum)) continue;
                var rend = child.GetComponent<Renderer>();
                if (rend == null) continue;
                risk.TryGetValue(bnum, out var r0); string r = r0 ?? "clean";
                if (bnum == _selectedBuilding)
                    rend.material.color = new Color(1f, 1f, 0.3f);
                else if (r == "hot")
                    rend.material.color = new Color(0.9f, 0.25f, 0.2f);
                else if (r == "watch")
                    rend.material.color = new Color(0.95f, 0.55f, 0.15f);
                else
                    rend.material.color = new Color(0.3f, 0.42f, 0.55f);
            }
        }

        void ApplyTurnRadar(TwinResponse twin)
        {
            Ensure(ref radarRoot, "TurnRadar");
            Clear(radarRoot);
            if (twin.turnRadar == null) return;
            foreach (var t in twin.turnRadar)
            {
                if (t.building <= 0 && t.lat == 0 && t.lng == 0) continue;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                go.name = $"Turn_{t.unitNo ?? t.jobNo}";
                go.transform.SetParent(radarRoot, false);
                go.transform.localScale = new Vector3(markerScale, 0.15f, markerScale);
                Vector3 pos = Vector3.zero;
                if (siteRenderer != null && t.building > 0)
                {
                    // approximate: grid layout Building_N
                    var child = siteRenderer.buildingsRoot?.Find($"Building_{t.building}");
                    if (child != null) pos = child.position + Vector3.up * 0.2f;
                }
                go.transform.position = pos;
                var rend = go.GetComponent<Renderer>();
                if (rend != null)
                {
                    rend.material.color = t.risk == "overdue"
                        ? new Color(1f, 0.15f, 0.1f, 0.7f)
                        : t.risk == "aging"
                            ? new Color(1f, 0.6f, 0.1f, 0.65f)
                            : new Color(0.2f, 0.8f, 0.4f, 0.5f);
                }
                var col = go.GetComponent<Collider>();
                if (col) Destroy(col);
            }
        }

        void ApplyBillboards(TwinResponse twin)
        {
            Ensure(ref billboardRoot, "PhotoBillboards");
            Clear(billboardRoot);
            if (twin.photoBillboards == null) return;
            int n = 0;
            foreach (var p in twin.photoBillboards)
            {
                if (n++ > 24) break;
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                go.name = $"Photo_{p.unitNo}_{p.phase}";
                go.transform.SetParent(billboardRoot, false);
                go.transform.localScale = new Vector3(4f, 3f, 1f);
                Vector3 pos = Vector3.up * 14f;
                if (p.building > 0)
                {
                    var child = siteRenderer?.buildingsRoot?.Find($"Building_{p.building}");
                    if (child != null) pos = child.position + Vector3.up * 16f + Vector3.forward * (n % 3);
                }
                go.transform.position = pos;
                if (Camera.main != null)
                    go.transform.rotation = Quaternion.LookRotation(go.transform.position - Camera.main.transform.position);
                var rend = go.GetComponent<Renderer>();
                if (rend != null)
                    rend.material.color = p.phase == "after"
                        ? new Color(0.3f, 0.85f, 0.5f)
                        : new Color(0.85f, 0.55f, 0.3f);
            }
        }

        void Ensure(ref Transform t, string name)
        {
            if (t != null) return;
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            t = go.transform;
        }

        void Clear(Transform t)
        {
            for (int i = t.childCount - 1; i >= 0; i--)
                Destroy(t.GetChild(i).gameObject);
        }
    }
}
