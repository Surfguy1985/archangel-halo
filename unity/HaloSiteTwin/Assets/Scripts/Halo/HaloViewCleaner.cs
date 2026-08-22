using System.Reflection;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Photoreal view: strip leftover Halo plates, tutorial cubes, and Cesium physics meshes.
    /// </summary>
    public static class HaloViewCleaner
    {
        static readonly string[] HideExact =
        {
            "HaloGround",
            "Ground",
            "Tutorial",
            "Collectibles",
            "Platform_Green_Floating",
            "Platform_Teal_Floating",
            "01_Box_Yellow",
            "02_Box_Orange",
            "03_Box_Orange",
            "04_Box_Red",
            "Cube_Hollow",
            "Secret_Area",
            "Hidden_Area_1",
            "Hidden_Area_2",
            "Hidden_Area_3",
            "Colliders",
            "PlayerRobot",
            "Player",
            "Postprocessing"
        };

        public static void Apply()
        {
            foreach (var name in HideExact)
            {
                var go = GameObject.Find(name);
                if (go == null) continue;
                if (name == "HaloGround")
                {
                    if (Application.isPlaying) Object.Destroy(go);
                    else Object.DestroyImmediate(go);
                    continue;
                }
                go.SetActive(false);
            }

            var campus = GameObject.Find("Campus");
            if (campus != null && campus.transform.root.GetComponent<SiteTwinRenderer>() != null)
                campus.SetActive(false);

            TuneCesium();
        }

        public static void TuneCesium()
        {
            TwinWorld.SetOrigin(ThornburySitePlan.Lat, ThornburySitePlan.Lng);

            foreach (var mb in Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (mb == null) continue;
                var t = mb.GetType();
                if (t.Name == "CesiumGeoreference")
                {
                    Set(mb, "latitude", ThornburySitePlan.Lat);
                    Set(mb, "longitude", ThornburySitePlan.Lng);
                    Set(mb, "height", ThornburySitePlan.EllipsoidHeightM);
                    TryCall(mb, "UpdateOrigin");
                    TryCall(mb, "MoveOrigin");
                    continue;
                }
                if (t.Name != "Cesium3DTileset") continue;
                Set(mb, "createPhysicsMeshes", false);
                Set(mb, "maximumScreenSpaceError", 8f);
                Set(mb, "showCreditsOnScreen", true);
            }
        }

        static void Set(object obj, string name, object value)
        {
            var p = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (p != null && p.CanWrite)
            {
                if (p.PropertyType == typeof(double) && value is float fl) p.SetValue(obj, (double)fl);
                else p.SetValue(obj, value);
                return;
            }
            var field = obj.GetType().GetField("_" + name, BindingFlags.NonPublic | BindingFlags.Instance);
            if (field == null) return;
            var v = value;
            if (field.FieldType == typeof(double) && value is float fl2) v = (double)fl2;
            field.SetValue(obj, v);
        }

        static void TryCall(object obj, string method)
        {
            var m = obj.GetType().GetMethod(method, BindingFlags.Public | BindingFlags.Instance, null, System.Type.EmptyTypes, null);
            m?.Invoke(obj, null);
        }
    }
}
