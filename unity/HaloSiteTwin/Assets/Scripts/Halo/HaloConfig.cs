using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Point at Halo API (Replit workspace or production).
    /// </summary>
    [CreateAssetMenu(menuName = "Halo/Site Twin Config")]
    public class HaloConfig : ScriptableObject
    {
        [Tooltip("e.g. https://archangel-halo.replit.app")]
        public string apiBase = "http://127.0.0.1:5000";

        public string propertyId = "";

        [Range(1f, 30f)]
        public float pollSeconds = 3f;

        public string TwinUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/building-ops";
        public string SnapshotUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/unity-twin";
        public string HealthUrl => $"{apiBase.TrimEnd('/')}/api/building-ops/health";
    }
}
