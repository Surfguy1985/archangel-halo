using System.Collections.Generic;
using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>
    /// Thornbury campus: real 3-story garden buildings from the leasing site plan,
    /// then live crew / densest tint from building-ops.
    /// </summary>
    public class SiteTwinRenderer : MonoBehaviour
    {
        public HaloApiClient client;
        public HaloConfig config;
        public Transform buildingsRoot;
        public Transform crewsRoot;
        public int densestBuilding = -1;

        readonly Dictionary<int, GameObject> _buildings = new();
        readonly Dictionary<string, GameObject> _crews = new();
        bool _campusBuilt;
        SiteCenter _origin;

        void OnEnable()
        {
            TwinWorld.SetOrigin(ThornburySitePlan.Lat, ThornburySitePlan.Lng);
            TwinWorld.Scale = config != null && config.worldScale > 0.2f ? config.worldScale : 1f;
            if (client != null) client.OnTwinUpdated += Apply;
            if (!_campusBuilt) BuildCampus();
        }

        void OnDisable()
        {
            if (client != null) client.OnTwinUpdated -= Apply;
        }

        void Start()
        {
            if (!_campusBuilt) BuildCampus();
        }

        void EnsureRoots()
        {
            if (buildingsRoot == null)
            {
                var go = new GameObject("Buildings");
                go.transform.SetParent(transform, false);
                buildingsRoot = go.transform;
            }
            if (crewsRoot == null)
            {
                var go = new GameObject("Crews");
                go.transform.SetParent(transform, false);
                crewsRoot = go.transform;
            }
        }

        void BuildCampus()
        {
            HaloViewCleaner.Apply();
            EnsureRoots();
            bool photoreal = config != null && config.useGooglePhotoreal && HaloLocalSecrets.HasKey(config);
            var osmN = OsmFootprintCampus.Build(buildingsRoot, out var numbered, solids: !photoreal);
            if (osmN > 0)
            {
                foreach (var kv in numbered) _buildings[kv.Key] = kv.Value;
            }
            else if (!photoreal)
            {
                SiteCampusBuilder.Build(transform);
                var lease = ThornburySitePlan.ImageToWorld(0.455f, 0.505f);
                foreach (var plan in ThornburySitePlan.Buildings)
                {
                    var pos = ThornburySitePlan.ImageToWorld(plan.ix, plan.iy);
                    var to = lease - pos;
                    to.y = 0f;
                    var rot = to.sqrMagnitude > 0.5f ? Quaternion.LookRotation(to.normalized) : Quaternion.identity;
                    var go = BuildingFactory.Create(plan, pos, rot);
                    go.transform.SetParent(buildingsRoot, true);
                    if (!plan.leasing) _buildings[plan.number] = go;
                }
            }
            _campusBuilt = true;
            if (photoreal) OsmFootprintCampus.HideSolids(buildingsRoot, true);
            FrameCamera(photoreal);
            Debug.Log($"[Halo Twin] Campus ready — {_buildings.Count} numbered (OSM footprints={osmN}) origin={TwinWorld.OriginLat:F6},{TwinWorld.OriginLng:F6} photoreal={photoreal}");
        }

        void Apply(TwinResponse twin)
        {
            if (!_campusBuilt) BuildCampus();
            if (twin?.site != null) _origin = twin.site;
            else _origin = new SiteCenter { lat = ThornburySitePlan.Lat, lng = ThornburySitePlan.Lng };

            densestBuilding = -1;
            int bestCount = 0;
            var counts = new Dictionary<int, int>();
            if (twin?.presence != null)
            {
                foreach (var p in twin.presence)
                {
                    if (!p.onSite || p.building <= 0) continue;
                    counts.TryGetValue(p.building, out var n);
                    counts[p.building] = n + 1;
                }
            }
            foreach (var kv in counts)
            {
                if (kv.Value > bestCount)
                {
                    bestCount = kv.Value;
                    densestBuilding = kv.Key;
                }
            }

            bool photoreal = config != null && config.useGooglePhotoreal && HaloLocalSecrets.HasKey(config);
            if (!photoreal)
            {
                foreach (var kv in _buildings)
                {
                    counts.TryGetValue(kv.Key, out var n);
                    bool dense = kv.Key == densestBuilding;
                    var mat = dense ? HaloMaterials.AccentHot : n > 0 ? HaloMaterials.AccentLive : null;
                    if (mat != null) BuildingFactory.TintMass(kv.Value, mat);
                    else
                    {
                        var planSkin = kv.Key % 3;
                        BuildingFactory.TintMass(kv.Value,
                            planSkin == 0 ? HaloMaterials.Brick : planSkin == 1 ? HaloMaterials.Stucco : HaloMaterials.BrickDeep);
                    }
                }
            }

            var seen = new HashSet<string>();
            if (twin?.presence != null)
            {
                foreach (var c in twin.presence)
                {
                    if (!c.onSite) continue;
                    if (c.lat == 0 && c.lng == 0 && c.building <= 0) continue;
                    seen.Add(c.crewId);

                    if (!_crews.TryGetValue(c.crewId, out var go) || !go)
                    {
                        go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                        go.name = c.crewName ?? c.crewId;
                        go.transform.SetParent(crewsRoot, false);
                        go.transform.localScale = new Vector3(1.1f, 0.9f, 1.1f);
                        go.GetComponent<Renderer>().sharedMaterial = HaloMaterials.Crew;
                        var col = go.GetComponent<Collider>();
                        if (col) Destroy(col);
                        _crews[c.crewId] = go;
                    }

                    Vector3 pos;
                    if (c.lat != 0 || c.lng != 0)
                        pos = TwinWorld.LatLngToWorld(c.lat, c.lng);
                    else if (c.building > 0 && _buildings.TryGetValue(c.building, out var bgo))
                        pos = bgo.transform.position + bgo.transform.forward * 8f;
                    else
                        pos = Vector3.zero;
                    pos.y = 1.1f;
                    go.transform.position = pos;
                }
            }

            var remove = new List<string>();
            foreach (var kv in _crews)
                if (!seen.Contains(kv.Key)) remove.Add(kv.Key);
            foreach (var id in remove)
            {
                if (_crews.TryGetValue(id, out var go) && go) Destroy(go);
                _crews.Remove(id);
            }
        }

        static void FrameCamera(bool photoreal = false)
        {
            var cam = Camera.main;
            if (cam == null) return;
            var orbit = cam.GetComponent<HaloOrbitCamera>();
            if (orbit == null) orbit = cam.gameObject.AddComponent<HaloOrbitCamera>();
            var root = GameObject.Find("HaloSiteTwin");
            if (root != null) orbit.target = root.transform;
            orbit.distance = photoreal ? 220f : 140f;
            orbit.pitch = 52f;
            orbit.yaw = 28f;
            if (photoreal)
            {
                orbit.maxDistance = 900f;
                orbit.minDistance = 25f;
                cam.farClipPlane = 80000f;
            }
        }

        public bool FocusBuilding(int building, Camera cam = null)
        {
            if (!_buildings.TryGetValue(building, out var go) || !go) return false;
            cam = cam != null ? cam : Camera.main;
            if (cam == null) return false;
            var orbit = cam.GetComponent<HaloOrbitCamera>();
            if (orbit != null)
            {
                orbit.target = go.transform;
                orbit.distance = 55f;
                orbit.pitch = 38f;
            }
            else
            {
                cam.transform.position = go.transform.position + Vector3.up * 28f + Vector3.back * 42f;
                cam.transform.LookAt(go.transform.position + Vector3.up * 6f);
            }
            densestBuilding = building;
            return true;
        }

        public bool FocusDensest(Camera cam = null)
        {
            if (densestBuilding <= 0) return false;
            return FocusBuilding(densestBuilding, cam);
        }

        public void FitCameraToAll()
        {
            FrameCamera();
        }
    }
}
