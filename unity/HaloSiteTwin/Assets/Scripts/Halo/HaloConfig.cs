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
        [Tooltip("1 = one Unity unit per meter. Keep at 1 so the campus matches Thornbury.")]
        public float worldScale = 1f;
        public float buildingHeight = 10f;
        public float metersPerDegreeLat = 111320f;

        [Header("Google Photoreal 3D Tiles")]
        [Tooltip("Map Tiles API key. Keep this off git. Halo → Google Photoreal loads it from HaloGoogleTiles.secret.json.")]
        public string googleMapTilesApiKey;
        [Tooltip("When on, OSM boxes hide and Cesium streams real exteriors.")]
        public bool useGooglePhotoreal = true;
        [Tooltip("WGS84 ellipsoid height in meters at 7101 Chase Oaks Blvd.")]
        public double photorealHeightM = 209.0;

        public string TwinUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/building-ops";
        public string SnapshotUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/unity-twin";
        public string HealthUrl => $"{apiBase.TrimEnd('/')}/api/building-ops/health";
        public string StreamUrl => $"{apiBase.TrimEnd('/')}/api/properties/{propertyId}/building-ops/stream";

        public string Google3DTilesUrl
        {
            get
            {
                var key = (googleMapTilesApiKey ?? "").Trim();
                if (key.Length == 0) return "";
                return "https://tile.googleapis.com/v1/3dtiles/root.json?key=" + key;
            }
        }
    }
}
