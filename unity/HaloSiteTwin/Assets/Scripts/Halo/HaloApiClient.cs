using System;
using System.Collections;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

namespace Halo.SiteTwin
{
    public class HaloApiClient : MonoBehaviour
    {
        public HaloConfig config;
        public event Action<TwinResponse> OnTwinUpdated;
        public event Action<string> OnError;

        TwinResponse _last;
        public TwinResponse Last => _last;
        public bool IsLive { get; private set; }
        public string LastError { get; private set; }
        public string LastUrl { get; private set; }
        public int LastHttpCode { get; private set; }

        void OnEnable()
        {
            if (config == null)
            {
                LastError = "No HaloConfig — menu Halo → Setup Site Twin Scene";
                Debug.LogError("[Halo] " + LastError);
                return;
            }
            StartCoroutine(BootAndPoll());
        }

        IEnumerator BootAndPoll()
        {
            // Health first so Mac TLS / DNS failures are obvious
            yield return PingHealth();
            var wait = new WaitForSeconds(Mathf.Max(1f, config.pollSeconds));
            while (enabled)
            {
                yield return FetchTwin();
                yield return wait;
            }
        }

        IEnumerator PingHealth()
        {
            LastUrl = config.HealthUrl;
            using var req = UnityWebRequest.Get(config.HealthUrl);
            req.timeout = 12;
            yield return req.SendWebRequest();
            LastHttpCode = (int)req.responseCode;
            if (req.result != UnityWebRequest.Result.Success)
            {
                LastError = $"Health failed: {req.error} code={req.responseCode} url={config.HealthUrl}";
                Debug.LogError("[Halo] " + LastError);
                OnError?.Invoke(LastError);
            }
            else
            {
                Debug.Log($"[Halo] Health OK ({req.responseCode}) {config.HealthUrl}");
            }
        }

        IEnumerator FetchTwin()
        {
            if (string.IsNullOrEmpty(config.propertyId))
            {
                LastError = "propertyId empty on HaloConfig";
                OnError?.Invoke(LastError);
                yield break;
            }

            LastUrl = config.TwinUrl;
            using var req = UnityWebRequest.Get(config.TwinUrl);
            req.timeout = 15;
            // Avoid caching
            req.SetRequestHeader("Cache-Control", "no-cache");
            yield return req.SendWebRequest();
            LastHttpCode = (int)req.responseCode;

            if (req.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"[Halo] building-ops failed: {req.error} — trying unity-twin");
                using var req2 = UnityWebRequest.Get(config.SnapshotUrl);
                req2.timeout = 15;
                LastUrl = config.SnapshotUrl;
                yield return req2.SendWebRequest();
                LastHttpCode = (int)req2.responseCode;
                if (req2.result != UnityWebRequest.Result.Success)
                {
                    IsLive = false;
                    LastError = $"{req2.error} HTTP {req2.responseCode} url={config.SnapshotUrl}";
                    Debug.LogError("[Halo] " + LastError);
                    OnError?.Invoke(LastError);
                    yield break;
                }
                ApplyJson(req2.downloadHandler.text);
                yield break;
            }
            ApplyJson(req.downloadHandler.text);
        }

        /// <summary>
        /// Unity JsonUtility breaks on JSON null for value types (lat/lng null from API).
        /// Object/string nulls must not become 0 — that turns "demo":null into a number
        /// and "at":null into a bogus timestamp, which can drop the whole plate.
        /// </summary>
        public static string SanitizeJsonForUnity(string json)
        {
            if (string.IsNullOrEmpty(json)) return json;
            json = Regex.Replace(json,
                @"""(demo|site|summary|selection)""\s*:\s*null\b",
                "\"$1\":{}");
            json = Regex.Replace(json,
                @"""(at|source|crewName|crewId|trade|title|jobId|jobNo|unitNo|buildingLabel|confidence|headline|propertyName|mode|label|risk|riskLabel|status|phase|note|storagePath|capturedAt|id)""\s*:\s*null\b",
                "\"$1\":\"\"");
            json = Regex.Replace(json, @":\s*null\b", ":0");
            return json;
        }

        void ApplyJson(string json)
        {
            try
            {
                var safe = SanitizeJsonForUnity(json);
                var data = JsonUtility.FromJson<TwinResponse>(safe);
                if (data == null)
                {
                    LastError = "JsonUtility returned null — check response shape";
                    Debug.LogError("[Halo] " + LastError + " raw len=" + json.Length);
                    IsLive = false;
                    return;
                }
                // Force lists non-null
                data.buildings = data.buildings ?? new System.Collections.Generic.List<BuildingPin>();
                data.presence = data.presence ?? new System.Collections.Generic.List<CrewPresence>();
                data.heat = data.heat ?? new System.Collections.Generic.List<HeatCell>();
                data.units = data.units ?? new System.Collections.Generic.List<UnitRow>();
                if (data.summary == null) data.summary = new TwinSummary { headline = "no summary" };
                if (data.site == null) data.site = new SiteCenter();
                if (data.demo == null) data.demo = new TwinDemoFlag();

                _last = data;
                IsLive = true;
                LastError = null;
                var nB = data.buildings.Count;
                var nC = 0;
                foreach (var p in data.presence) if (p.onSite) nC++;
                Debug.Log($"[Halo Twin] {data.summary.headline} | buildings={nB} onSite={nC} demo={data.summary.demoActive || data.demo.active} property={data.propertyName}");
                OnTwinUpdated?.Invoke(data);
            }
            catch (Exception e)
            {
                IsLive = false;
                LastError = e.Message;
                Debug.LogError("[Halo] parse error: " + e.Message);
                OnError?.Invoke(e.Message);
            }
        }

        public void FetchOnce() => StartCoroutine(FetchTwin());

        [ContextMenu("Fetch Once")]
        void FetchOnceMenu() => FetchOnce();

        [ContextMenu("Log Config")]
        void LogConfig()
        {
            if (config == null) { Debug.LogError("No config"); return; }
            Debug.Log($"[Halo] apiBase={config.apiBase}\npropertyId={config.propertyId}\nTwinUrl={config.TwinUrl}");
        }
    }
}
