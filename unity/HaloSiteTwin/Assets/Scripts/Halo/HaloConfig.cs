using UnityEngine;

namespace Halo.SiteTwin
{
    [CreateAssetMenu(menuName = "Halo/Site Twin Config", fileName = "HaloSiteTwinConfig")]
    public class HaloConfig : ScriptableObject
    {
        [Header("API")]
        [Tooltip("Production: https://archangel-halo.replit.app")]
        public string apiBase = "https://archangel-halo.replit.app";

        [Tooltip("Thornbury: 49dec4b1-1dc5-4b59-8025-0c0bc14d35ce")]
        public string propertyId = "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce";

        [Range(1f, 30f)]
        public float pollSeconds = 3f;

        [Header("World")]
        public float worldScale = 0.05f;
        public float buildingHeight = 8f;
        public float metersPerDegreeLat = 111320f;

        public string TwinUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/building-ops";
        public string SnapshotUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/unity-twin";
        public string HealthUrl => $"{apiBase.TrimEnd('/')}/api/building-ops/health";
        public string StreamUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/building-ops/stream";
    }
}
