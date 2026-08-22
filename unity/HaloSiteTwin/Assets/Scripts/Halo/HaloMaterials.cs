using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>URP/Built-in lit materials so the campus is not magenta in URP projects.</summary>
    public static class HaloMaterials
    {
        static Shader _lit;

        public static Shader LitShader
        {
            get
            {
                if (_lit != null) return _lit;
                _lit = Shader.Find("Universal Render Pipeline/Lit")
                    ?? Shader.Find("HDRP/Lit")
                    ?? Shader.Find("Standard")
                    ?? Shader.Find("Diffuse")
                    ?? Shader.Find("Unlit/Color");
                return _lit;
            }
        }

        public static Material Make(Color color, float smoothness = 0.18f, float metallic = 0f)
        {
            var mat = new Material(LitShader);
            ApplyColor(mat, color);
            if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", smoothness);
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", smoothness);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", metallic);
            return mat;
        }

        public static void ApplyColor(Material mat, Color color)
        {
            if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", color);
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", color);
            mat.color = color;
        }

        public static readonly Material Brick = Make(new Color(0.62f, 0.41f, 0.32f));
        public static readonly Material BrickDeep = Make(new Color(0.48f, 0.30f, 0.24f));
        public static readonly Material Stucco = Make(new Color(0.86f, 0.80f, 0.70f));
        public static readonly Material Cream = Make(new Color(0.92f, 0.88f, 0.78f));
        public static readonly Material Trim = Make(new Color(0.95f, 0.93f, 0.88f), 0.25f);
        public static readonly Material Roof = Make(new Color(0.27f, 0.23f, 0.21f), 0.08f);
        public static readonly Material Glass = Make(new Color(0.38f, 0.52f, 0.62f), 0.85f, 0.15f);
        public static readonly Material Grass = Make(new Color(0.38f, 0.52f, 0.28f), 0.05f);
        public static readonly Material GrassDark = Make(new Color(0.28f, 0.40f, 0.22f), 0.05f);
        public static readonly Material Asphalt = Make(new Color(0.22f, 0.22f, 0.24f), 0.12f);
        public static readonly Material Concrete = Make(new Color(0.55f, 0.54f, 0.50f), 0.1f);
        public static readonly Material Water = Make(new Color(0.18f, 0.52f, 0.68f), 0.92f, 0.05f);
        public static readonly Material Foliage = Make(new Color(0.22f, 0.42f, 0.18f), 0.08f);
        public static readonly Material Trunk = Make(new Color(0.35f, 0.24f, 0.14f), 0.05f);
        public static readonly Material AccentLive = Make(new Color(0.25f, 0.72f, 0.55f), 0.3f);
        public static readonly Material AccentHot = Make(new Color(0.25f, 0.62f, 0.92f), 0.35f);
        public static readonly Material Crew = Make(new Color(1f, 0.78f, 0.18f), 0.4f);
    }
}
