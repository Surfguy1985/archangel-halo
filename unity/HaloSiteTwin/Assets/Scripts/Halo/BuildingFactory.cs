using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// 1994 Plano garden apartments: 3-story brick/stucco bars, gable roofs,
    /// window grid, stair tower, building number. Sized from unit count.
    /// </summary>
    public static class BuildingFactory
    {
        const float StoryH = 3.15f;
        const float Stories = 3f;
        const float Depth = 13.2f;
        const float Bay = 7.6f;

        public static GameObject Create(ThornburySitePlan.Bldg plan, Vector3 pos, Quaternion rot)
        {
            var root = new GameObject(plan.leasing ? "Leasing Office" : $"Building {plan.number}");
            root.transform.SetPositionAndRotation(pos, rot);

            if (plan.leasing)
            {
                BuildLeasing(root.transform);
                return root;
            }

            int floors = 3;
            int unitsPerFloor = Mathf.Max(2, Mathf.CeilToInt(plan.units / (float)floors));
            int bays = Mathf.Clamp(Mathf.CeilToInt(unitsPerFloor / 2f), 2, 8);
            float length = bays * Bay;
            float height = StoryH * Stories;
            var skin = SkinFor(plan.number);

            var body = Box("Mass", root.transform, new Vector3(0, height * 0.5f, 0), new Vector3(length, height, Depth), skin.body);
            StripCollider(body);

            var water = Box("WaterTable", root.transform, new Vector3(0, 0.28f, 0), new Vector3(length + 0.35f, 0.56f, Depth + 0.35f), HaloMaterials.Concrete);
            StripCollider(water);

            var stair = Box("Stair", root.transform, new Vector3(0, height * 0.5f, Depth * 0.5f + 0.7f), new Vector3(3.4f, height, 1.6f), skin.accent);
            StripCollider(stair);

            var roof = new GameObject("Roof");
            roof.transform.SetParent(root.transform, false);
            roof.transform.localPosition = new Vector3(0, height, 0);
            var mf = roof.AddComponent<MeshFilter>();
            mf.sharedMesh = GableMesh(length + 0.8f, Depth + 1.4f, 2.4f);
            var mr = roof.AddComponent<MeshRenderer>();
            mr.sharedMaterial = HaloMaterials.Roof;

            AddWindows(root.transform, length, height, Depth, bays, floors);
            AddNumber(root.transform, plan.number, height, Depth);

            return root;
        }

        struct Skin { public Material body, accent; }

        static Skin SkinFor(int n)
        {
            switch (n % 3)
            {
                case 0: return new Skin { body = HaloMaterials.Brick, accent = HaloMaterials.Trim };
                case 1: return new Skin { body = HaloMaterials.Stucco, accent = HaloMaterials.BrickDeep };
                default: return new Skin { body = HaloMaterials.BrickDeep, accent = HaloMaterials.Cream };
            }
        }

        static void BuildLeasing(Transform root)
        {
            float w = 22f, d = 14f, h = 4.4f;
            StripCollider(Box("Club", root, new Vector3(0, h * 0.5f, 0), new Vector3(w, h, d), HaloMaterials.Cream));
            StripCollider(Box("Porch", root, new Vector3(0, 0.18f, d * 0.5f + 1.2f), new Vector3(10f, 0.36f, 3.2f), HaloMaterials.Concrete));
            var roof = new GameObject("Roof");
            roof.transform.SetParent(root, false);
            roof.transform.localPosition = new Vector3(0, h, 0);
            var mf = roof.AddComponent<MeshFilter>();
            mf.sharedMesh = GableMesh(w + 1.2f, d + 2.2f, 2.8f);
            var mr = roof.AddComponent<MeshRenderer>();
            mr.sharedMaterial = HaloMaterials.Roof;
            var label = new GameObject("LeasingLabel");
            label.transform.SetParent(root, false);
            label.transform.localPosition = new Vector3(0, h + 3.2f, 0);
            var tm = label.AddComponent<TextMesh>();
            tm.text = "LEASING";
            tm.fontSize = 42;
            tm.characterSize = 0.12f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = Color.white;
        }

        static void AddWindows(Transform root, float length, float height, float depth, int bays, int floors)
        {
            var winRoot = new GameObject("Windows");
            winRoot.transform.SetParent(root, false);
            float startX = -length * 0.5f + Bay * 0.5f;
            for (int floor = 0; floor < floors; floor++)
            {
                float y = StoryH * (floor + 0.52f);
                for (int bay = 0; bay < bays; bay++)
                {
                    if (bay == bays / 2) continue; // stair bay
                    float x = startX + bay * Bay;
                    foreach (float zSign in new[] { -1f, 1f })
                    {
                        float z = zSign * (depth * 0.5f + 0.06f);
                        var w = Box($"W-{floor}-{bay}-{zSign}", winRoot.transform,
                            new Vector3(x, y, z),
                            new Vector3(1.55f, 1.45f, 0.12f),
                            HaloMaterials.Glass);
                        StripCollider(w);
                        if (floor > 0)
                        {
                            var bal = Box($"Bal-{floor}-{bay}-{zSign}", winRoot.transform,
                                new Vector3(x, y - 0.85f, z + zSign * 0.55f),
                                new Vector3(2.1f, 0.12f, 1.0f),
                                HaloMaterials.Trim);
                            StripCollider(bal);
                            var rail = Box($"Rail-{floor}-{bay}-{zSign}", winRoot.transform,
                                new Vector3(x, y - 0.45f, z + zSign * 0.95f),
                                new Vector3(2.1f, 0.72f, 0.08f),
                                HaloMaterials.Trim);
                            StripCollider(rail);
                        }
                    }
                }
            }
        }

        static void AddNumber(Transform root, int number, float height, float depth)
        {
            var go = new GameObject("Number");
            go.transform.SetParent(root, false);
            go.transform.localPosition = new Vector3(0, height * 0.62f, depth * 0.5f + 1.55f);
            var tm = go.AddComponent<TextMesh>();
            tm.text = number.ToString();
            tm.fontSize = 64;
            tm.characterSize = 0.08f;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.color = Color.white;
        }

        public static void TintMass(GameObject building, Material mat)
        {
            var mass = building.transform.Find("Mass");
            if (mass == null) return;
            var r = mass.GetComponent<Renderer>();
            if (r != null) r.sharedMaterial = mat;
        }

        static GameObject Box(string name, Transform parent, Vector3 localPos, Vector3 size, Material mat)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = size;
            var r = go.GetComponent<Renderer>();
            if (r != null) r.sharedMaterial = mat;
            return go;
        }

        static void StripCollider(GameObject go)
        {
            var c = go.GetComponent<Collider>();
            if (c) Object.Destroy(c);
        }

        static Mesh GableMesh(float length, float depth, float rise)
        {
            float hx = length * 0.5f;
            float hz = depth * 0.5f;
            var v = new Vector3[]
            {
                new Vector3(-hx, 0, -hz),
                new Vector3( hx, 0, -hz),
                new Vector3( hx, 0,  hz),
                new Vector3(-hx, 0,  hz),
                new Vector3(-hx, rise, 0),
                new Vector3( hx, rise, 0),
            };
            var t = new int[]
            {
                0, 5, 1, 0, 4, 5, // south slope
                3, 5, 4, 3, 2, 5, // north slope
                0, 3, 4,          // west gable
                1, 5, 2,          // east gable
            };
            var mesh = new Mesh { name = "GableRoof" };
            mesh.vertices = v;
            mesh.triangles = t;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
