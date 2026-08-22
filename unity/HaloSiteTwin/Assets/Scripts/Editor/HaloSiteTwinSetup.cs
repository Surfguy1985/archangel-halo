#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Halo.SiteTwin;
using Halo.SiteTwin.MCP;

namespace Halo.SiteTwin.EditorTools
{
    /// <summary>
    /// One-click full scene: MainCamera, light, ground, Halo twin stack, HUD.
    /// Menu: Halo → Setup Site Twin Scene
    /// </summary>
    public static class HaloSiteTwinSetup
    {
        const string ConfigPath = "Assets/HaloSiteTwinConfig.asset";

        [MenuItem("Halo/Setup Site Twin Scene")]
        public static void SetupScene()
        {
            Undo.IncrementCurrentGroup();
            int group = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("Halo Site Twin Setup");

            var config = EnsureConfig();
            EnsureCamera();
            EnsureLight();
            EnsureGround();
            EnsureHaloRoot(config);

            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            Undo.CollapseUndoOperations(group);

            Debug.Log("[Halo] FULL SETUP DONE — Press Play. You should see Thornbury: 20 three-story buildings, leasing, pool. Drag to orbit.");
            EditorUtility.DisplayDialog(
                "Halo Site Twin",
                "Setup complete.\n\nPress Play to load Thornbury at Chase Oaks (20 garden buildings).\nDrag to orbit · scroll to zoom.\nTop-left HUD = LIVE / Connecting.",
                "OK");
        }

        [MenuItem("Halo/Fix Camera Only")]
        public static void FixCameraOnly()
        {
            EnsureCamera();
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            Debug.Log("[Halo] Main Camera fixed. Press Play.");
            EditorUtility.DisplayDialog("Halo", "Main Camera ready. Press Play.", "OK");
        }

        [MenuItem("Halo/Diagnose — Log Config & Test URLs")]
        public static void Diagnose()
        {
            var client = Object.FindObjectOfType<HaloApiClient>();
            if (client == null || client.config == null)
            {
                Debug.LogError("[Halo] No client — run Halo → Setup Site Twin Scene");
                return;
            }
            var c = client.config;
            Debug.Log($"[Halo DIAG]\napiBase={c.apiBase}\npropertyId={c.propertyId}\nHealth={c.HealthUrl}\nTwin={c.TwinUrl}\nphotoreal={c.useGooglePhotoreal} key={(HaloLocalSecrets.HasKey(c) ? "present" : "missing")}");
        }

        static HaloConfig EnsureConfig()
        {
            var config = AssetDatabase.LoadAssetAtPath<HaloConfig>(ConfigPath);
            if (config == null)
            {
                config = ScriptableObject.CreateInstance<HaloConfig>();
                config.apiBase = "https://archangel-halo.replit.app";
                config.propertyId = "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce";
                config.pollSeconds = 3f;
                config.worldScale = 1f;
                AssetDatabase.CreateAsset(config, ConfigPath);
                AssetDatabase.SaveAssets();
            }
            if (config.worldScale < 0.5f) config.worldScale = 1f;
            EditorUtility.SetDirty(config);
            return config;
        }

        static void EnsureCamera()
        {
            Camera cam = Camera.main;
            if (cam == null)
            {
                var all = Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
                if (all != null && all.Length > 0) cam = all[0];
            }

            if (cam == null)
            {
                var go = new GameObject("Main Camera");
                Undo.RegisterCreatedObjectUndo(go, "Create Main Camera");
                cam = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
                go.tag = "MainCamera";
            }
            else
            {
                cam.gameObject.tag = "MainCamera";
                cam.gameObject.name = "Main Camera";
                if (cam.GetComponent<AudioListener>() == null)
                    cam.gameObject.AddComponent<AudioListener>();
            }

            // Frame the 250m Thornbury campus
            cam.transform.position = new Vector3(55f, 165f, -210f);
            cam.transform.rotation = Quaternion.Euler(50f, 18f, 0f);
            cam.fieldOfView = 50f;
            cam.nearClipPlane = 0.5f;
            cam.farClipPlane = 80000f;
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.backgroundColor = new Color(0.55f, 0.72f, 0.90f);
            cam.enabled = true;
            if (cam.GetComponent<HaloOrbitCamera>() == null)
                Undo.AddComponent<HaloOrbitCamera>(cam.gameObject);

            // Only one audio listener
            foreach (var al in Object.FindObjectsByType<AudioListener>(FindObjectsSortMode.None))
            {
                if (al.gameObject != cam.gameObject)
                    Object.DestroyImmediate(al);
            }

            Selection.activeGameObject = cam.gameObject;
        }

        static void EnsureLight()
        {
            var lights = Object.FindObjectsByType<Light>(FindObjectsSortMode.None);
            Light sun = null;
            foreach (var l in lights)
            {
                if (l.type == LightType.Directional) { sun = l; break; }
            }
            if (sun == null)
            {
                var go = new GameObject("Directional Light");
                Undo.RegisterCreatedObjectUndo(go, "Create Light");
                sun = go.AddComponent<Light>();
                sun.type = LightType.Directional;
            }
            sun.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
            sun.intensity = 1.2f;
            sun.color = new Color(1f, 0.96f, 0.88f);
            sun.shadows = LightShadows.Soft;
            RenderSettings.ambientLight = new Color(0.42f, 0.46f, 0.40f);
        }

        static void EnsureGround()
        {
            HaloViewCleaner.Apply();
        }

        static void EnsureHaloRoot(HaloConfig config)
        {
            var root = GameObject.Find("HaloSiteTwin");
            if (root == null)
            {
                root = new GameObject("HaloSiteTwin");
                Undo.RegisterCreatedObjectUndo(root, "Create HaloSiteTwin");
            }

            var client = root.GetComponent<HaloApiClient>() ?? Undo.AddComponent<HaloApiClient>(root);
            client.config = config;

            var renderer = root.GetComponent<SiteTwinRenderer>() ?? Undo.AddComponent<SiteTwinRenderer>(root);
            renderer.client = client;
            renderer.config = config;

            var heat = root.GetComponent<HeatRenderer>() ?? Undo.AddComponent<HeatRenderer>(root);
            heat.client = client;
            heat.config = config;

            var bridge = root.GetComponent<HaloTwinMcpBridge>() ?? Undo.AddComponent<HaloTwinMcpBridge>(root);
            bridge.client = client;
            bridge.siteRenderer = renderer;
            bridge.heatRenderer = heat;

            var hud = root.GetComponent<HaloHud>() ?? Undo.AddComponent<HaloHud>(root);
            hud.client = client;
            hud.siteRenderer = renderer;

            // Runtime safety net
            if (root.GetComponent<HaloEnsureCamera>() == null)
                Undo.AddComponent<HaloEnsureCamera>(root);

            var osm = root.GetComponent<OsmFootprintLoader>() ?? Undo.AddComponent<OsmFootprintLoader>(root);
            osm.config = config;
            osm.loadOnStart = !config.useGooglePhotoreal;
            osm.replaceGridWhenLoaded = !config.useGooglePhotoreal;

            var layers = root.GetComponent<SiteTwinLayersRenderer>() ?? Undo.AddComponent<SiteTwinLayersRenderer>(root);
            layers.client = client;
            layers.siteRenderer = renderer;

            var matched = root.GetComponent<OsmMatchedLoader>() ?? Undo.AddComponent<OsmMatchedLoader>(root);
            matched.config = config;
            matched.gridToHide = renderer;
            matched.loadOnStart = !config.useGooglePhotoreal;

            var cam = Camera.main;
            if (cam != null)
            {
                var orbit = cam.GetComponent<HaloOrbitCamera>();
                if (orbit != null) orbit.target = root.transform;
            }

            EditorUtility.SetDirty(root);
            EditorUtility.SetDirty(client);
        }
    }
}
#endif
