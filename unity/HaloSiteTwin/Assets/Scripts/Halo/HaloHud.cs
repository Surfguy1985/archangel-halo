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
                line = $"LIVE · {client.Last.summary.headline}\nDensest Bldg {siteRenderer?.densestBuilding}\n{client.LastUrl}";
            else
                line = "Connecting to Halo…\n" + (client.LastUrl ?? "");

            GUI.Box(new Rect(12, 12, 520, 72), line, _style);
        }
    }
}
