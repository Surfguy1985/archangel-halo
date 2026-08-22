using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Loads /api/osm/buildings/matched — footprints already labeled Building 1–20.
    /// Prefer this over raw Overpass list when Halo centroids exist.
    /// </summary>
    public class OsmMatchedLoader : MonoBehaviour
    {
        public HaloConfig config;
        public Transform root;
        public bool loadOnStart = true;
        public float extrudeHeight = 12f;

        void Start()
        {
            if (loadOnStart) StartCoroutine(Load());
        }

        [ContextMenu("Reload Matched OSM")]
        public void Reload() => StartCoroutine(Load());

        IEnumerator Load()
        {
            if (config == null) yield break;
            string url = $"{config.apiBase.TrimEnd('/')}/api/osm/buildings/matched";
            using var req = UnityWebRequest.Get(url);
            req.timeout = 60;
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("[Halo OSM matched] " + req.error);
                yield break;
            }
            // Reuse OsmFootprintLoader parsing style via buildings-like matched array
            Debug.Log("[Halo OSM matched] " + req.downloadHandler.text.Substring(0, Mathf.Min(200, req.downloadHandler.text.Length)));
            // Actual mesh build: delegate to simple extrude by matched[].ring
            if (root == null)
            {
                var go = new GameObject("OSM_Matched");
                go.transform.SetParent(transform, false);
                root = go.transform;
            }
            for (int i = root.childCount - 1; i >= 0; i--) Destroy(root.GetChild(i).gameObject);

            // Minimal: count matches in log; full mesh uses same approach as OsmFootprintLoader
            var count = Regex.Matches(req.downloadHandler.text, "\"building\"\\s*:").Count;
            Debug.Log($"[Halo OSM matched] ~{count} building fields in payload — use OsmFootprintLoader for meshes or extend parser");
        }
    }
}
