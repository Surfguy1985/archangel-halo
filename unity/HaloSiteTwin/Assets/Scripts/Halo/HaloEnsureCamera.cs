using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Runtime: if Game view has no MainCamera, create one on Play.
    /// Does not stomp HaloOrbitCamera after the campus frames the shot.
    /// </summary>
    public class HaloEnsureCamera : MonoBehaviour
    {
        void Awake()
        {
            var cam = Camera.main;
            if (cam == null)
            {
                var found = FindObjectsByType<Camera>(FindObjectsSortMode.None);
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
                cam.transform.position = new Vector3(40f, 160f, -200f);
                cam.transform.rotation = Quaternion.Euler(50f, 18f, 0f);
                Debug.Log("[Halo] Runtime created Main Camera");
            }

            cam.enabled = true;
            cam.farClipPlane = Mathf.Max(cam.farClipPlane, 2000f);
            cam.nearClipPlane = 0.3f;
            if (cam.GetComponent<HaloOrbitCamera>() == null)
                cam.gameObject.AddComponent<HaloOrbitCamera>();
        }
    }
}
