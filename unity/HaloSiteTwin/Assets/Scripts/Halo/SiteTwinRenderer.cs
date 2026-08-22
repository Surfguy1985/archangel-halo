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

        /// <summary>
        /// Live GPS farther than this from 7101 Chase Oaks is the old Ridge Hollow pin.
        /// Place those crews on their snapped building so the photoreal twin is not empty.
        /// </summary>
        public const float CampusRadiusMeters = 280f;

        readonly Dictionary<int, GameObject> _buildings = new();
        readonly Dictionary<string, GameObject> _crews = new();
        bool _campusBuilt;
        SiteCenter _origin;
        public int lastSnappedToBuilding;

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
            if (photoreal && HaloViewCleaner.HasCesiumTileset())
                OsmFootprintCampus.HideSolids(buildingsRoot, true);
            else if (photoreal)
                Debug.LogWarning("[Halo Twin] Photoreal is on but no Cesium3DTileset — keeping OSM solids so the campus is visible.");
            FrameCamera(photoreal);
            Debug.Log($"[Halo Twin] Campus ready — {_buildings.Count} numbered (OSM footprints={osmN}) origin={TwinWorld.OriginLat:F6},{TwinWorld.OriginLng:F6} photoreal={photoreal} cesium={HaloViewCleaner.HasCesiumTileset()}");
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
            lastSnappedToBuilding = 0;
            if (twin?.presence != null)
            {
                foreach (var c in twin.presence)
                {
                    if (!c.onSite) continue;
                    if (!TwinWorld.HasGps(c.lat, c.lng) && c.building <= 0) continue;
                    seen.Add(c.crewId);

                    try
                    {
                        if (!_crews.TryGetValue(c.crewId, out var go) || !go)
                        {
                            go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                            go.transform.SetParent(crewsRoot, false);
                            go.transform.localScale = new Vector3(1.1f, 0.9f, 1.1f);
                            var col = go.GetComponent<Collider>();
                            if (col) Destroy(col);
                            _crews[c.crewId] = go;
                        }

                        var demo = IsDemoCrew(c);
                        go.name = demo ? "[DEMO] " + (c.crewName ?? c.crewId) : (c.crewName ?? c.crewId);
                        var rend = go.GetComponent<Renderer>();
                        if (rend != null)
                            rend.sharedMaterial = demo ? HaloMaterials.CrewDemo : HaloMaterials.Crew;
                        EnsureDemoBadge(go, demo);
                        EnsureNameplate(go, c.crewName ?? "Crew", demo);
                        try { EnsurePulse(go, !demo); }
                        catch (System.Exception pulseEx)
                        {
                            Debug.LogWarning("[Halo Twin] pulse skipped for " + go.name + ": " + pulseEx.Message);
                        }

                        var pos = PlaceCrew(c, out var snapped);
                        if (snapped) lastSnappedToBuilding++;
                        go.transform.position = pos;
                    }
                    catch (System.Exception ex)
                    {
                        Debug.LogWarning("[Halo Twin] crew skipped " + c.crewId + ": " + ex.Message);
                    }
                }
            }
            if (lastSnappedToBuilding > 0)
                Debug.Log($"[Halo Twin] {lastSnappedToBuilding} on-site crew(s) GPS is off Chase Oaks — shown at assigned building.");

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
            Transform targetXf = null;
            if (_buildings.TryGetValue(building, out var go) && go) targetXf = go.transform;
            if (targetXf == null)
            {
                var pos = BuildingWorld(building);
                if (pos.sqrMagnitude < 0.01f) return false;
                var anchor = transform.Find("FocusAnchor");
                if (anchor == null)
                {
                    var a = new GameObject("FocusAnchor");
                    a.transform.SetParent(transform, false);
                    anchor = a.transform;
                }
                pos.y = 1.1f;
                anchor.position = pos;
                targetXf = anchor;
            }
            cam = cam != null ? cam : Camera.main;
            if (cam == null) return false;
            var orbit = cam.GetComponent<HaloOrbitCamera>();
            if (orbit != null)
            {
                orbit.target = targetXf;
                orbit.distance = 55f;
                orbit.pitch = 38f;
            }
            else
            {
                cam.transform.position = targetXf.position + Vector3.up * 28f + Vector3.back * 42f;
                cam.transform.LookAt(targetXf.position + Vector3.up * 6f);
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

        Vector3 PlaceCrew(CrewPresence c, out bool snappedToBuilding)
        {
            snappedToBuilding = false;
            var buildingPos = BuildingWorld(c.building);
            var hasGps = TwinWorld.HasGps(c.lat, c.lng);
            var onCampus = hasGps && TwinWorld.HorizontalMetersFromOrigin(c.lat, c.lng) <= CampusRadiusMeters;

            Vector3 pos;
            if (onCampus)
            {
                pos = TwinWorld.LatLngToWorld(c.lat, c.lng);
            }
            else if (buildingPos.sqrMagnitude > 0.01f || c.building > 0)
            {
                snappedToBuilding = hasGps || c.building > 0;
                pos = buildingPos;
                var hash = Mathf.Abs((c.crewId ?? "").GetHashCode());
                var yaw = (hash % 8) * 45f;
                pos += Quaternion.Euler(0f, yaw, 0f) * Vector3.forward * 6f;
            }
            else if (hasGps)
            {
                pos = TwinWorld.LatLngToWorld(c.lat, c.lng);
            }
            else
            {
                pos = Vector3.zero;
            }
            pos.y = 1.1f;
            return pos;
        }

        Vector3 BuildingWorld(int number)
        {
            if (number > 0 && _buildings.TryGetValue(number, out var go) && go)
                return go.transform.position;
            foreach (var plan in ThornburySitePlan.Buildings)
            {
                if (plan.number != number) continue;
                return ThornburySitePlan.ImageToWorld(plan.ix, plan.iy);
            }
            return Vector3.zero;
        }

        static bool IsDemoCrew(CrewPresence c)
        {
            if (c == null) return false;
            if (c.demo) return true;
            if (!string.IsNullOrEmpty(c.source) && c.source == "demo") return true;
            return !string.IsNullOrEmpty(c.crewId) && c.crewId.StartsWith("demo:");
        }

        static void EnsureDemoBadge(GameObject go, bool demo)
        {
            var existing = go.transform.Find("DemoLabel");
            if (demo)
            {
                if (existing != null) return;
                var t = new GameObject("DemoLabel");
                t.transform.SetParent(go.transform, false);
                t.transform.localPosition = new Vector3(0f, 1.65f, 0f);
                var tm = t.AddComponent<TextMesh>();
                tm.text = "DEMO";
                tm.anchor = TextAnchor.MiddleCenter;
                tm.alignment = TextAlignment.Center;
                tm.characterSize = 0.08f;
                tm.fontSize = 64;
                tm.color = new Color(0.95f, 0.35f, 0.85f);
            }
            else if (existing != null)
            {
                Object.Destroy(existing.gameObject);
            }
        }

        static void EnsureNameplate(GameObject go, string name, bool demo)
        {
            var existing = go.transform.Find("Nameplate");
            TextMesh tm;
            if (existing == null)
            {
                var t = new GameObject("Nameplate");
                t.transform.SetParent(go.transform, false);
                t.transform.localPosition = new Vector3(0f, demo ? 2.05f : 1.75f, 0f);
                t.AddComponent<HaloBillboard>();
                tm = t.AddComponent<TextMesh>();
                tm.anchor = TextAnchor.MiddleCenter;
                tm.alignment = TextAlignment.Center;
                tm.characterSize = 0.07f;
                tm.fontSize = 64;
                tm.fontStyle = FontStyle.Bold;
            }
            else
            {
                tm = existing.GetComponent<TextMesh>();
                existing.localPosition = new Vector3(0f, demo ? 2.05f : 1.75f, 0f);
            }
            if (tm == null) return;
            var first = name.Trim();
            var sp = first.IndexOf(' ');
            if (sp > 0) first = first.Substring(0, sp);
            tm.text = first;
            tm.color = demo ? new Color(0.96f, 0.82f, 1f) : new Color(0.71f, 1f, 0.27f);
        }

        static void EnsurePulse(GameObject go, bool live)
        {
            var existing = go.transform.Find("Pulse");
            if (live)
            {
                HaloPulseRing ring;
                if (existing == null)
                {
                    var pulse = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                    pulse.name = "Pulse";
                    pulse.transform.SetParent(go.transform, false);
                    pulse.transform.localPosition = new Vector3(0f, -0.85f, 0f);
                    var col = pulse.GetComponent<Collider>();
                    if (col) Object.Destroy(col);
                    ring = pulse.AddComponent<HaloPulseRing>();
                }
                else
                {
                    ring = existing.GetComponent<HaloPulseRing>();
                }
                if (ring != null) ring.live = true;
            }
            else if (existing != null)
            {
                var ring = existing.GetComponent<HaloPulseRing>();
                if (ring != null) ring.live = false;
            }
        }
    }
}
