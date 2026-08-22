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

            Debug.Log("[Halo] FULL SETUP DONE — Press Play. Game view should show ground + buildings. HUD top-left = LIVE/ERROR.");
            EditorUtility.DisplayDialog(
                "Halo Site Twin",
                "Setup complete.\n\n• Main Camera created & framed\n• Light + ground\n• Twin stack wired\n\nPress Play.\nTop-left HUD must say LIVE.",
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
            Debug.Log($"[Halo DIAG]\napiBase={c.apiBase}\npropertyId={c.propertyId}\nHealth={c.HealthUrl}\nTwin={c.TwinUrl}");
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
                AssetDatabase.CreateAsset(config, ConfigPath);
                AssetDatabase.SaveAssets();
            }
            return config;
        }

        static void EnsureCamera()
        {
            Camera cam = Camera.main;
            if (cam == null)
            {
                var all = Object.FindObjectsOfType<Camera>();
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

            // Frame the site twin plate
            cam.transform.position = new Vector3(0f, 95f, -75f);
            cam.transform.rotation = Quaternion.Euler(48f, 0f, 0f);
            cam.fieldOfView = 60f;
            cam.nearClipPlane = 0.3f;
            cam.farClipPlane = 2000f;
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.enabled = true;

            // Only one audio listener
            foreach (var al in Object.FindObjectsOfType<AudioListener>())
            {
                if (al.gameObject != cam.gameObject)
                    Object.DestroyImmediate(al);
            }

            Selection.activeGameObject = cam.gameObject;
        }

        static void EnsureLight()
        {
            var lights = Object.FindObjectsOfType<Light>();
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
            sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            sun.intensity = 1.1f;
            sun.color = Color.white;
        }

        static void EnsureGround()
        {
            var ground = GameObject.Find("HaloGround");
            if (ground == null)
            {
                ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
                ground.name = "HaloGround";
                Undo.RegisterCreatedObjectUndo(ground, "Create Ground");
            }
            ground.transform.position = Vector3.zero;
            ground.transform.localScale = new Vector3(25f, 1f, 25f);
            var r = ground.GetComponent<Renderer>();
            if (r != null)
            {
                // Default material tint if possible
                r.sharedMaterial = new Material(Shader.Find("Standard") ?? Shader.Find("Diffuse"));
                if (r.sharedMaterial != null)
                    r.sharedMaterial.color = new Color(0.07f, 0.09f, 0.12f);
            }
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
            osm.loadOnStart = true;
            osm.replaceGridWhenLoaded = true;

            EditorUtility.SetDirty(root);
            EditorUtility.SetDirty(client);
        }
    }
}
#endif
