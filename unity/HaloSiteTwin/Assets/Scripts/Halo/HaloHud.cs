using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>On-screen status so Mac users see failures without digging Console.</summary>
    public class HaloHud : MonoBehaviour
    {
        public HaloApiClient client;
        public SiteTwinRenderer siteRenderer;
        GUIStyle _style;

        void OnGUI()
        {
            if (_style == null)
            {
                _style = new GUIStyle(GUI.skin.box)
                {
                    fontSize = 14,
                    alignment = TextAnchor.UpperLeft,
                    normal = { textColor = Color.white },
                    padding = new RectOffset(10, 10, 8, 8),
                };
            }
            string line;
            if (client == null)
                line = "HaloHud: assign HaloApiClient";
            else if (!string.IsNullOrEmpty(client.LastError))
                line = "ERROR: " + client.LastError;
            else if (client.IsLive && client.Last?.summary != null)
                line = $"LIVE · {client.Last.propertyName ?? "Thornbury"}\n{client.Last.summary.headline}\nDensest Bldg {siteRenderer?.densestBuilding}  ·  drag to orbit, scroll to zoom";
            else if (siteRenderer != null)
                line = "Thornbury · OpenStreetMap WGS84\nReal footprints + roads · connecting Halo…";
            else
                line = "Connecting to Halo…\n" + (client.LastUrl ?? "");

            GUI.Box(new Rect(12, 12, 560, 78), line, _style);
        }
    }
}
