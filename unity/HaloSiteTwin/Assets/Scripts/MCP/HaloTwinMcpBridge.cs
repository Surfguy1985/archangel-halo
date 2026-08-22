using UnityEngine;
using Halo.SiteTwin;

namespace Halo.SiteTwin.MCP
{
    /// <summary>
    /// Runtime hooks for Unity MCP / AI agents and Inspector debug.
    /// </summary>
    public class HaloTwinMcpBridge : MonoBehaviour
    {
        public SiteTwinRenderer siteRenderer;
        public HaloApiClient client;
        public HeatRenderer heatRenderer;

        public string GetHeadline() => client?.Last?.summary?.headline ?? "no data";

        public int OnSiteCount() => client?.Last?.summary?.onSite ?? 0;

        public int DensestBuilding() => siteRenderer != null ? siteRenderer.densestBuilding : -1;

        public bool FocusBuilding(int building) =>
            siteRenderer != null && siteRenderer.FocusBuilding(building);

        public void FitAll()
        {
            if (siteRenderer != null) siteRenderer.FitCameraToAll();
        }

        public bool FocusDensest() =>
            siteRenderer != null && siteRenderer.FocusDensest();

        public string ListOnSiteCrew()
        {
            var twin = client?.Last;
            if (twin?.presence == null) return "(no data)";
            var sb = new System.Text.StringBuilder();
            foreach (var p in twin.presence)
            {
                if (!p.onSite) continue;
                sb.AppendLine($"{p.crewName} | Bldg {p.building} | {p.title}");
            }
            return sb.Length == 0 ? "(none on site)" : sb.ToString();
        }

        public string DescribeHeat()
        {
            var twin = client?.Last;
            if (twin?.heat == null) return "0 cells";
            return $"{twin.heat.Count} heat cells · {GetHeadline()}";
        }

        public void Refresh() => client?.FetchOnce();

        public bool IsLive() => client != null && client.IsLive;

        [ContextMenu("Log Headline")]
        void MenuHeadline() => Debug.Log(GetHeadline());

        [ContextMenu("Log On-Site")]
        void MenuOnSite() => Debug.Log(ListOnSiteCrew());

        [ContextMenu("Focus Densest")]
        void MenuFocus() => Debug.Log(FocusDensest() ? $"Focused {DensestBuilding()}" : "No densest");

        [ContextMenu("Fit All Buildings")]
        void MenuFitAll() => FitAll();
    }
}
