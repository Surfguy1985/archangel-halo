using UnityEngine;
using Halo.SiteTwin;

namespace Halo.SiteTwin.MCP
{
    public class HaloTwinMcpBridge : MonoBehaviour
    {
        public SiteTwinRenderer siteRenderer;
        public HaloApiClient client;
        public HeatRenderer heatRenderer;

        public string GetHeadline() => client?.Last?.summary?.headline ?? "no data";

        public int OnSiteCount() => client?.Last?.summary?.onSite ?? 0;

        public bool FocusBuilding(int building)
        {
            return siteRenderer != null && siteRenderer.FocusBuilding(building);
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
            return lines.Length == 0 ? "(none on site)" : lines.ToString();
        }

        public string DescribeHeat()
        {
            var twin = client?.Last;
            if (twin?.heat == null) return "0 cells";
            return $"{twin.heat.Count} heat cells · densest buildings: {JsonUtility.ToJson(twin.summary)}";
        }

        public void Refresh()
        {
            if (client != null) client.FetchOnce();
        }

        [ContextMenu("Log Headline")]
        void LogHeadline() => Debug.Log(GetHeadline());

        [ContextMenu("Log On-Site")]
        void LogOnSite() => Debug.Log(ListOnSiteCrew());
    }
}
