using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Runtime: if Game view has no MainCamera, create one on Play.
    /// </summary>
    public class HaloEnsureCamera : MonoBehaviour
    {
        void Awake()
        {
            var cam = Camera.main;
            if (cam == null)
            {
                var found = FindObjectsOfType<Camera>();
                if (found != null && found.Length > 0)
                {
                    cam = found[0];
                    cam.tag = "MainCamera";
                }
            }

            if (cam == null)
            {
                var go = new GameObject("Main Camera");
                cam = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
                go.tag = "MainCamera";
                Debug.Log("[Halo] Runtime created Main Camera");
            }

            cam.transform.position = new Vector3(0f, 95f, -75f);
            cam.transform.rotation = Quaternion.Euler(48f, 0f, 0f);
            cam.enabled = true;
            cam.farClipPlane = Mathf.Max(cam.farClipPlane, 2000f);
        }
    }
}
