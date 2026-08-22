using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>Live-GPS radar ring. Demo crews stay still so mock never reads as a ping.</summary>
    public class HaloPulseRing : MonoBehaviour
    {
        public Color color = new Color(0.706f, 1f, 0.267f, 0.7f);
        public bool live = true;
        Material _mat;

        void Awake()
        {
            var rend = GetComponent<Renderer>();
            if (rend == null) return;
            var shader = HaloMaterials.LitShader;
            if (shader == null)
            {
                rend.enabled = false;
                return;
            }
            _mat = new Material(shader);
            HaloMaterials.ApplyColor(_mat, color);
            rend.sharedMaterial = _mat;
        }

        void LateUpdate()
        {
            if (!live)
            {
                transform.localScale = Vector3.zero;
                return;
            }
            var t = (Time.time % 1.8f) / 1.8f;
            var s = 0.9f + t * 3.4f;
            transform.localScale = new Vector3(s, 0.025f, s);
            if (_mat == null) return;
            var c = color;
            c.a = (1f - t) * 0.55f;
            HaloMaterials.ApplyColor(_mat, c);
        }
    }
}
