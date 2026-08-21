using UnityEngine;
using Halo.SiteTwin;

namespace Halo.SiteTwin.MCP
{
    /// <summary>
    /// Runtime hooks for AI / Unity MCP custom tools.
    /// Wire these from Editor MCP custom tools or a local TCP bridge.
    /// </summary>
    public class HaloTwinMcpBridge : MonoBehaviour
    {
        public SiteTwinRenderer renderer;
        public HaloApiClient client;

        public string GetHeadline()
        {
            return client?.Last?.summary?.headline ?? "no data";
        }

        public int OnSiteCount()
        {
            return client?.Last?.summary?.onSite ?? 0;
        }

        public bool FocusBuilding(int building)
        {
            return renderer != null && renderer.FocusBuilding(building);
        }

        public string ListOnSiteCrew()
        {
            var twin = client?.Last;
            if (twin?.presence == null) return "[]";
            var lines = new System.Text.StringBuilder();
            foreach (var p in twin.presence)
            {
                if (!p.onSite) continue;
                lines.AppendLine($"{p.crewName} | {p.title}");
            }
            return lines.ToString();
        }

        [ContextMenu("Log Headline")]
        void LogHeadline() => Debug.Log(GetHeadline());
    }
}
