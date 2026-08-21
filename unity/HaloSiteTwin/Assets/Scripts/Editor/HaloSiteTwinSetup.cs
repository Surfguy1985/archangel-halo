#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;
using Halo.SiteTwin;
using Halo.SiteTwin.MCP;

namespace Halo.SiteTwin.EditorTools
{
    public static class HaloSiteTwinSetup
    {
        [MenuItem("Halo/Setup Site Twin Scene")]
        public static void SetupScene()
        {
            const string configPath = "Assets/HaloSiteTwinConfig.asset";
            var config = AssetDatabase.LoadAssetAtPath<HaloConfig>(configPath);
            if (config == null)
            {
                config = ScriptableObject.CreateInstance<HaloConfig>();
                config.apiBase = "https://archangel-halo.replit.app";
                config.propertyId = "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce";
                config.pollSeconds = 3f;
                AssetDatabase.CreateAsset(config, configPath);
                AssetDatabase.SaveAssets();
            }

            var root = GameObject.Find("HaloSiteTwin");
            if (root == null) root = new GameObject("HaloSiteTwin");

            var client = root.GetComponent<HaloApiClient>() ?? root.AddComponent<HaloApiClient>();
            client.config = config;

            var renderer = root.GetComponent<SiteTwinRenderer>() ?? root.AddComponent<SiteTwinRenderer>();
            renderer.client = client;
            renderer.config = config;

            var heat = root.GetComponent<HeatRenderer>() ?? root.AddComponent<HeatRenderer>();
            heat.client = client;
            heat.config = config;

            var bridge = root.GetComponent<HaloTwinMcpBridge>() ?? root.AddComponent<HaloTwinMcpBridge>();
            bridge.client = client;
            bridge.siteRenderer = renderer;
            bridge.heatRenderer = heat;

            var hud = root.GetComponent<HaloHud>() ?? root.AddComponent<HaloHud>();
            hud.client = client;
            hud.siteRenderer = renderer;

            if (Camera.main != null)
            {
                Camera.main.transform.position = new Vector3(0, 90, -70);
                Camera.main.transform.LookAt(Vector3.zero);
            }

            // Ground plane for scale reference
            if (GameObject.Find("HaloGround") == null)
            {
                var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
                ground.name = "HaloGround";
                ground.transform.localScale = new Vector3(20, 1, 20);
                var r = ground.GetComponent<Renderer>();
                if (r) r.material.color = new Color(0.08f, 0.1f, 0.14f);
            }

            Selection.activeGameObject = root;
            EditorUtility.SetDirty(root);
            Debug.Log("[Halo] Site Twin ready. Press Play. Top-left HUD shows LIVE or ERROR. Console: [Halo Twin] …");
        }

        [MenuItem("Halo/Diagnose — Log Config & Test URLs")]
        public static void Diagnose()
        {
            var client = Object.FindObjectOfType<HaloApiClient>();
            if (client == null || client.config == null)
            {
                Debug.LogError("[Halo] No HaloApiClient in scene — run Halo → Setup Site Twin Scene");
                return;
            }
            var c = client.config;
            Debug.Log($"[Halo DIAG]\napiBase={c.apiBase}\npropertyId={c.propertyId}\nHealth={c.HealthUrl}\nTwin={c.TwinUrl}\n\nFrom Terminal test:\ncurl -s '{c.HealthUrl}'\ncurl -s '{c.TwinUrl}' | head -c 400");
        }
    }
}
#endif
