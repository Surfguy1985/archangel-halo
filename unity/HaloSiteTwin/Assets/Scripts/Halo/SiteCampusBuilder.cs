using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>Grass, drives, parking, pool, trees — the Chase Oaks campus around the buildings.</summary>
    public static class SiteCampusBuilder
    {
        public static void Build(Transform parent)
        {
            if (parent.Find("Campus") != null) return;
            var campus = new GameObject("Campus");
            campus.transform.SetParent(parent, false);

            var grass = GameObject.CreatePrimitive(PrimitiveType.Plane);
            grass.name = "Lawn";
            grass.transform.SetParent(campus.transform, false);
            grass.transform.localScale = new Vector3(32f, 1f, 32f); // 320m
            grass.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Grass;
            Object.Destroy(grass.GetComponent<Collider>());

            // Inner courtyard around leasing
            var court = Quad("Courtyard", campus.transform, ThornburySitePlan.ImageToWorld(0.48f, 0.48f), 38f, 32f, HaloMaterials.GrassDark);
            court.transform.position += Vector3.up * 0.02f;

            Drive(campus.transform, 0.48f, 0.62f, 90f, 8f, HaloMaterials.Asphalt);
            Drive(campus.transform, 0.32f, 0.48f, 8f, 70f, HaloMaterials.Asphalt);
            Drive(campus.transform, 0.62f, 0.48f, 8f, 78f, HaloMaterials.Asphalt);
            Drive(campus.transform, 0.48f, 0.22f, 110f, 8f, HaloMaterials.Asphalt);
            Drive(campus.transform, 0.70f, 0.22f, 70f, 8f, HaloMaterials.Asphalt);

            var poolPos = ThornburySitePlan.ImageToWorld(0.50f, 0.44f) + Vector3.up * 0.08f;
            var pool = GameObject.CreatePrimitive(PrimitiveType.Cube);
            pool.name = "Pool";
            pool.transform.SetParent(campus.transform, false);
            pool.transform.position = poolPos;
            pool.transform.localScale = new Vector3(14f, 0.35f, 7.5f);
            pool.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Water;
            Object.Destroy(pool.GetComponent<Collider>());

            var deck = GameObject.CreatePrimitive(PrimitiveType.Cube);
            deck.name = "PoolDeck";
            deck.transform.SetParent(campus.transform, false);
            deck.transform.position = poolPos + new Vector3(0, -0.12f, 0);
            deck.transform.localScale = new Vector3(20f, 0.12f, 12f);
            deck.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Concrete;
            Object.Destroy(deck.GetComponent<Collider>());

            // Parking pads behind a few clusters
            Pad(campus.transform, 0.22f, 0.62f, 28f, 12f);
            Pad(campus.transform, 0.78f, 0.22f, 32f, 12f);
            Pad(campus.transform, 0.22f, 0.22f, 22f, 10f);
            Pad(campus.transform, 0.78f, 0.58f, 24f, 10f);

            var rng = new System.Random(7101);
            foreach (var b in ThornburySitePlan.Buildings)
            {
                var origin = ThornburySitePlan.ImageToWorld(b.ix, b.iy);
                int n = b.leasing ? 6 : 4;
                for (int i = 0; i < n; i++)
                {
                    float ang = (float)(rng.NextDouble() * Mathf.PI * 2);
                    float dist = 14f + (float)rng.NextDouble() * 10f;
                    var p = origin + new Vector3(Mathf.Cos(ang) * dist, 0, Mathf.Sin(ang) * dist);
                    Tree(campus.transform, p, 2.2f + (float)rng.NextDouble() * 1.6f);
                }
            }
        }

        static void Drive(Transform parent, float ix, float iy, float w, float d, Material mat)
        {
            var pos = ThornburySitePlan.ImageToWorld(ix, iy) + Vector3.up * 0.04f;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Drive";
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            go.transform.localScale = new Vector3(w, 0.08f, d);
            go.GetComponent<Renderer>().sharedMaterial = mat;
            Object.Destroy(go.GetComponent<Collider>());
        }

        static void Pad(Transform parent, float ix, float iy, float w, float d)
        {
            Drive(parent, ix, iy, w, d, HaloMaterials.Asphalt);
        }

        static GameObject Quad(string name, Transform parent, Vector3 pos, float w, float d, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.position = pos;
            go.transform.localScale = new Vector3(w, 0.04f, d);
            go.GetComponent<Renderer>().sharedMaterial = mat;
            Object.Destroy(go.GetComponent<Collider>());
            return go;
        }

        static void Tree(Transform parent, Vector3 pos, float h)
        {
            var t = new GameObject("Tree");
            t.transform.SetParent(parent, false);
            t.transform.position = pos;
            var trunk = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            trunk.name = "Trunk";
            trunk.transform.SetParent(t.transform, false);
            trunk.transform.localPosition = new Vector3(0, h * 0.28f, 0);
            trunk.transform.localScale = new Vector3(0.45f, h * 0.28f, 0.45f);
            trunk.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Trunk;
            Object.Destroy(trunk.GetComponent<Collider>());
            var leaf = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            leaf.name = "Canopy";
            leaf.transform.SetParent(t.transform, false);
            leaf.transform.localPosition = new Vector3(0, h * 0.78f, 0);
            leaf.transform.localScale = new Vector3(h * 0.95f, h * 0.85f, h * 0.95f);
            leaf.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Foliage;
            Object.Destroy(leaf.GetComponent<Collider>());
        }
    }
}
