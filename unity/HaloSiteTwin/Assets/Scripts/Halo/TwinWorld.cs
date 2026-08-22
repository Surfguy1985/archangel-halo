using UnityEngine;

namespace Halo.SiteTwin
{
    public static class TwinWorld
    {
        public const float MetersPerDeg = 111320f;
        public static float Scale = 1f;
        public static double OriginLat = ThornburySitePlan.Lat;
        public static double OriginLng = ThornburySitePlan.Lng;

        public static void SetOrigin(double lat, double lng)
        {
            OriginLat = lat;
            OriginLng = lng;
        }

        public static Vector3 LatLngToWorld(double lat, double lng)
        {
            return LatLngToWorld(lat, lng, OriginLat, OriginLng);
        }

        public static Vector3 LatLngToWorld(double lat, double lng, double originLat, double originLng)
        {
            double dLat = lat - originLat;
            double dLng = lng - originLng;
            float z = (float)(dLat * MetersPerDeg * Scale);
            float cos = Mathf.Cos((float)(originLat * Mathf.Deg2Rad));
            float x = (float)(dLng * MetersPerDeg * cos * Scale);
            return new Vector3(x, 0f, z);
        }

        public static Vector3 LatLngToWorld(double lat, double lng, SiteCenter origin)
        {
            if (origin == null) return LatLngToWorld(lat, lng);
            return LatLngToWorld(lat, lng, origin.lat, origin.lng);
        }
    }
}
