using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>Keeps a world label facing the camera so names stay readable in orbit.</summary>
    public class HaloBillboard : MonoBehaviour
    {
        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            var dir = transform.position - cam.transform.position;
            if (dir.sqrMagnitude < 0.001f) return;
            transform.rotation = Quaternion.LookRotation(dir);
        }
    }
}
