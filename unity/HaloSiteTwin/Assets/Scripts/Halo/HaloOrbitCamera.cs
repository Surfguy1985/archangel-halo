using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace Halo.SiteTwin
{
    /// <summary>Orbit the Thornbury campus: drag to look, scroll to zoom.</summary>
    public class HaloOrbitCamera : MonoBehaviour
    {
        public Transform target;
        public float distance = 210f;
        public float minDistance = 40f;
        public float maxDistance = 420f;
        public float yaw = 18f;
        public float pitch = 48f;
        public float sensitivity = 0.12f;
        public float zoomSpeed = 0.08f;

        void LateUpdate()
        {
            var look = target != null ? target.position : Vector3.zero;
            look.y = 4f;

            float dx = 0f, dy = 0f, scroll = 0f;
            bool drag = false;
#if ENABLE_INPUT_SYSTEM
            var mouse = Mouse.current;
            if (mouse != null)
            {
                drag = mouse.leftButton.isPressed || mouse.rightButton.isPressed;
                var d = mouse.delta.ReadValue();
                dx = d.x;
                dy = d.y;
                scroll = mouse.scroll.ReadValue().y;
            }
#else
            drag = Input.GetMouseButton(0) || Input.GetMouseButton(1);
            dx = Input.GetAxis("Mouse X") * 12f;
            dy = Input.GetAxis("Mouse Y") * 12f;
            scroll = Input.GetAxis("Mouse ScrollWheel") * 120f;
#endif
            if (drag)
            {
                yaw += dx * sensitivity;
                pitch = Mathf.Clamp(pitch - dy * sensitivity, 18f, 80f);
            }
            distance = Mathf.Clamp(distance - scroll * zoomSpeed, minDistance, maxDistance);

            var rot = Quaternion.Euler(pitch, yaw, 0f);
            transform.position = look + rot * new Vector3(0f, 0f, -distance);
            transform.LookAt(look);
        }
    }
}
