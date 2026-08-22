#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Halo.SiteTwin;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Halo.SiteTwin.EditorTools
{
    public static class HaloPhotorealSetup
    {
        const string ConfigPath = "Assets/HaloSiteTwinConfig.asset";

        [MenuItem("Halo/Real exteriors — OpenStreetMap (open, in project)")]
        public static void ExplainOsm()
        {
            EditorUtility.DisplayDialog(
                "OpenStreetMap footprints",
                "HALO already bundled real building footprints for Thornbury from OpenStreetMap (ODbL).\n\nPress Play — those are the actual outlines, extruded 3 stories.\n\nHugging Face GlobalBuildingAtlas is the same LoD1 box class, not photoreal brick.",
                "OK");
            Application.OpenURL("https://www.openstreetmap.org/#map=18/33.07327/-96.69556");
        }

        [MenuItem("Halo/Real exteriors — Hugging Face GlobalBuildingAtlas")]
        public static void OpenHuggingFace()
        {
            Application.OpenURL("https://huggingface.co/datasets/zhu-xlab/GBA.ODbLPolygon");
            Application.OpenURL("https://huggingface.co/datasets/zhu-xlab/GBA.LoD1");
            Debug.Log("[Halo] Hugging Face GBA is LoD1 footprints+height (boxes), not Google-style photogrammetry.");
        }

        [MenuItem("Halo/Google Photoreal 3D Tiles — install Cesium + drop at Thornbury")]
        public static void InstallAndDrop()
        {
            EnsureCesiumRegistry();
            bool added = EnsureCesiumPackage();
            var key = LoadKeyIntoConfig();
            if (string.IsNullOrEmpty(key))
            {
                EditorUtility.DisplayDialog(
                    "Google Map Tiles key missing",
                    "Put the key in Assets/HaloGoogleTiles.secret.json (googleMapTilesApiKey) then run this menu again.\n\nDo not commit that file.",
                    "OK");
                return;
            }

            if (FindCesiumType("CesiumGeoreference") == null)
            {
                AssetDatabase.Refresh();
                EditorUtility.DisplayDialog(
                    added ? "Cesium is downloading" : "Wait for Cesium import",
                    "Unity is importing Cesium for Unity (large native plugin).\n\nWait until the spinner stops, then run:\nHalo → Google Photoreal 3D Tiles — install Cesium + drop at Thornbury",
                    "OK");
                return;
            }

            if (!DropGoogleTiles(key))
            {
                EditorUtility.DisplayDialog(
                    "Cesium types not ready",
                    "Cesium is in the project but the tileset API did not bind. Wait for compile, then run this menu again.",
                    "OK");
                return;
            }

            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            Debug.Log($"[Halo] Google Photoreal 3D Tiles dropped at {ThornburySitePlan.Address} ({ThornburySitePlan.Lat:F7}, {ThornburySitePlan.Lng:F7}).");
            EditorUtility.DisplayDialog(
                "Photoreal exteriors",
                "Google Photorealistic 3D Tiles are pinned to\n7101 Chase Oaks Blvd, Plano, TX 75025\n33.0732679, -96.6955596\n\nPress Play. Attribution stays on screen.",
                "OK");
        }

        static string LoadKeyIntoConfig()
        {
            var config = AssetDatabase.LoadAssetAtPath<HaloConfig>(ConfigPath);
            if (config == null)
            {
                Debug.LogError("[Halo] HaloSiteTwinConfig.asset missing — run Halo → Setup Site Twin Scene first.");
                return HaloLocalSecrets.ReadKey();
            }
            config.useGooglePhotoreal = true;
            EditorUtility.SetDirty(config);
            AssetDatabase.SaveAssets();
            return HaloLocalSecrets.ResolveKey(config);
        }

        static bool DropGoogleTiles(string key)
        {
            var geoType = FindCesiumType("CesiumGeoreference");
            var tilesType = FindCesiumType("Cesium3DTileset");
            var sourceType = FindCesiumType("CesiumDataSource");
            if (geoType == null || tilesType == null || sourceType == null) return false;

            var config = AssetDatabase.LoadAssetAtPath<HaloConfig>(ConfigPath);
            double lat = ThornburySitePlan.Lat;
            double lng = ThornburySitePlan.Lng;
            double height = config != null && config.photorealHeightM > 1
                ? config.photorealHeightM
                : ThornburySitePlan.EllipsoidHeightM;

            var geoGo = GameObject.Find("CesiumGeoreference");
            if (geoGo == null)
            {
                geoGo = new GameObject("CesiumGeoreference");
                Undo.RegisterCreatedObjectUndo(geoGo, "Halo CesiumGeoreference");
            }
            geoGo.transform.position = Vector3.zero;
            geoGo.transform.rotation = Quaternion.identity;
            geoGo.transform.localScale = Vector3.one;

            var geo = geoGo.GetComponent(geoType) ?? Undo.AddComponent(geoGo, geoType);
            SetDouble(geo, "latitude", lat);
            SetDouble(geo, "longitude", lng);
            SetDouble(geo, "height", height);

            Transform tilesTf = geoGo.transform.Find("Google Photorealistic 3D Tiles");
            GameObject tilesGo = tilesTf != null ? tilesTf.gameObject : null;
            if (tilesGo == null)
            {
                tilesGo = new GameObject("Google Photorealistic 3D Tiles");
                Undo.RegisterCreatedObjectUndo(tilesGo, "Halo Google 3D Tiles");
                tilesGo.transform.SetParent(geoGo.transform, false);
            }

            var tiles = tilesGo.GetComponent(tilesType) ?? Undo.AddComponent(tilesGo, tilesType);
            object fromUrl = Enum.Parse(sourceType, "FromUrl");
            SetProp(tiles, "tilesetSource", fromUrl);
            SetProp(tiles, "url", "https://tile.googleapis.com/v1/3dtiles/root.json?key=" + key);
            SetProp(tiles, "showCreditsOnScreen", true);
            SetProp(tiles, "createPhysicsMeshes", false);
            SetProp(tiles, "maximumScreenSpaceError", 8f);
            HaloViewCleaner.Apply();

            var halo = GameObject.Find("HaloSiteTwin");
            if (halo != null && halo.transform.parent != geoGo.transform)
            {
                Undo.SetTransformParent(halo.transform, geoGo.transform, "Parent Halo under Cesium");
                halo.transform.localPosition = Vector3.zero;
                halo.transform.localRotation = Quaternion.identity;
            }

            var cam = Camera.main;
            if (cam != null)
            {
                cam.farClipPlane = 80000f;
                cam.nearClipPlane = 0.5f;
            }

            Selection.activeGameObject = tilesGo;
            return true;
        }

        static Type FindCesiumType(string shortName)
        {
            var full = "CesiumForUnity." + shortName;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(full);
                    if (t != null) return t;
                }
                catch
                {
                    // skip dynamic assemblies
                }
            }
            return Type.GetType(full + ", CesiumForUnity");
        }

        static void SetDouble(object obj, string name, double value)
        {
            var t = obj.GetType();
            var p = t.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (p != null && p.CanWrite)
            {
                if (p.PropertyType == typeof(double)) p.SetValue(obj, value);
                else if (p.PropertyType == typeof(float)) p.SetValue(obj, (float)value);
                return;
            }
            var f = t.GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (f == null) f = t.GetField("_" + name, BindingFlags.NonPublic | BindingFlags.Instance);
            if (f != null) f.SetValue(obj, Convert.ChangeType(value, f.FieldType));
        }

        static void SetProp(object obj, string name, object value)
        {
            var p = obj.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
            if (p != null && p.CanWrite) p.SetValue(obj, value);
        }

        static bool EnsureCesiumPackage()
        {
            var path = Path.Combine(Application.dataPath, "..", "Packages", "manifest.json");
            if (!File.Exists(path)) return false;
            var text = File.ReadAllText(path);
            if (text.Contains("\"com.cesium.unity\"")) return false;
            const string needle = "\"dependencies\": {";
            int i = text.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return false;
            int insert = i + needle.Length;
            text = text.Insert(insert, "\n    \"com.cesium.unity\": \"1.25.0\",");
            File.WriteAllText(path, text);
            AssetDatabase.Refresh();
            Debug.Log("[Halo] Added com.cesium.unity 1.25.0 to Packages/manifest.json");
            return true;
        }

        static void EnsureCesiumRegistry()
        {
            var path = Path.Combine(Application.dataPath, "..", "Packages", "manifest.json");
            if (!File.Exists(path)) return;
            var text = File.ReadAllText(path);
            if (text.Contains("unity.pkg.cesium.com")) return;
            var insert = @",
  ""scopedRegistries"": [
    {
      ""name"": ""Cesium"",
      ""url"": ""https://unity.pkg.cesium.com"",
      ""scopes"": [ ""com.cesium.unity"" ]
    }
  ]";
            var idx = text.LastIndexOf('}');
            if (idx < 0) return;
            text = text.Substring(0, idx) + insert + "\n}\n";
            File.WriteAllText(path, text);
            AssetDatabase.Refresh();
            Debug.Log("[Halo] Added Cesium scoped registry to Packages/manifest.json");
        }
    }
}
#endif
