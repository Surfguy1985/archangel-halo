using System;
using System.IO;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Local-only Google Map Tiles key. File lives at Assets/HaloGoogleTiles.secret.json
    /// and must never be committed.
    /// </summary>
    public static class HaloLocalSecrets
    {
        const string FileName = "HaloGoogleTiles.secret.json";

        [Serializable]
        class SecretFile
        {
            public string googleMapTilesApiKey;
        }

        public static string SecretPath => Path.Combine(Application.dataPath, FileName);

        public static string ResolveKey(HaloConfig config)
        {
            var fromConfig = config?.googleMapTilesApiKey?.Trim();
            if (!string.IsNullOrEmpty(fromConfig)) return fromConfig;
            return ReadKey();
        }

        public static bool HasKey(HaloConfig config)
        {
            return !string.IsNullOrEmpty(ResolveKey(config));
        }

        public static string ReadKey()
        {
            var path = SecretPath;
            if (!File.Exists(path)) return "";
            try
            {
                var data = JsonUtility.FromJson<SecretFile>(File.ReadAllText(path));
                return data?.googleMapTilesApiKey?.Trim() ?? "";
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Halo] Could not read HaloGoogleTiles.secret.json: " + e.Message);
                return "";
            }
        }
    }
}
