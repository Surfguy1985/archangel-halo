using System;
using System.Collections;
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

        void OnEnable()
        {
            if (config == null)
            {
                Debug.LogError("[Halo] Assign HaloConfig asset");
                return;
            }
            StartCoroutine(PollLoop());
        }

        IEnumerator PollLoop()
        {
            var wait = new WaitForSeconds(Mathf.Max(1f, config.pollSeconds));
            while (enabled)
            {
                yield return FetchTwin();
                yield return wait;
            }
        }

        IEnumerator FetchTwin()
        {
            if (string.IsNullOrEmpty(config.propertyId))
            {
                OnError?.Invoke("propertyId empty");
                yield break;
            }

            // Prefer live building-ops (crews + heat); unity-twin is geometry metadata
            using var req = UnityWebRequest.Get(config.TwinUrl);
            req.timeout = 15;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                using var req2 = UnityWebRequest.Get(config.SnapshotUrl);
                req2.timeout = 15;
                yield return req2.SendWebRequest();
                if (req2.result != UnityWebRequest.Result.Success)
                {
                    OnError?.Invoke(req2.error);
                    yield break;
                }
                ApplyJson(req2.downloadHandler.text);
                yield break;
            }
            ApplyJson(req.downloadHandler.text);
        }

        void ApplyJson(string json)
        {
            try
            {
                var data = JsonUtility.FromJson<TwinResponse>(json);
                _last = data;
                OnTwinUpdated?.Invoke(data);
            }
            catch (Exception e)
            {
                OnError?.Invoke(e.Message);
            }
        }

        [ContextMenu("Fetch Once")]
        public void FetchOnce()
        {
            StartCoroutine(FetchTwin());
        }
    }
}
