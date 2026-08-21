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
            // Config asset
            const string configPath = "Assets/HaloSiteTwinConfig.asset";
            var config = AssetDatabase.LoadAssetAtPath<HaloConfig>(configPath);
            if (config == null)
            {
                config = ScriptableObject.CreateInstance<HaloConfig>();
                config.apiBase = "https://archangel-halo.replit.app";
                config.propertyId = "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce";
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

            // Camera
            if (Camera.main != null)
            {
                Camera.main.transform.position = new Vector3(0, 80, -60);
                Camera.main.transform.LookAt(Vector3.zero);
            }

            Selection.activeGameObject = root;
            Debug.Log("[Halo] Site Twin scene ready. Press Play. Install Unity MCP: Window → MCP for Unity.");
        }

        [MenuItem("Halo/Open UNITY_MCP_HALO docs path")]
        public static void OpenDocsHint()
        {
            Debug.Log("See repo root UNITY_MCP_HALO.md — CoplayDev package: https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity");
        }
    }
}
#endif
