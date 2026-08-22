using UnityEngine;

namespace Halo.SiteTwin
{
    /// <summary>Command HUD: live vs DEMO, roster, legend, densest focus. D toggles demo, F focuses densest.</summary>
    public class HaloHud : MonoBehaviour
    {
        public HaloApiClient client;
        public SiteTwinRenderer siteRenderer;
        GUIStyle _bar;
        GUIStyle _title;
        GUIStyle _body;
        GUIStyle _chip;
        GUIStyle _btn;
        GUIStyle _demoBtn;
        GUIStyle _row;
        Vector2 _scroll;

        void Update()
        {
            if (client == null || client.config == null) return;
            if (Input.GetKeyDown(KeyCode.D))
            {
                client.config.thornburyDemo = !client.config.thornburyDemo;
                client.FetchOnce();
            }
            if (Input.GetKeyDown(KeyCode.F) && siteRenderer != null)
                siteRenderer.FocusDensest();
        }

        void OnGUI()
        {
            EnsureStyles();
            var demo = IsDemo();
            var twin = client != null ? client.Last : null;
            var liveCount = 0;
            var demoCount = 0;
            if (twin?.presence != null)
            {
                foreach (var p in twin.presence)
                {
                    if (!p.onSite) continue;
                    if (IsDemoCrew(p)) demoCount++;
                    else liveCount++;
                }
            }

            var top = demo ? 118f : 96f;
            GUI.Box(new Rect(12, 12, 560, top), GUIContent.none, _bar);
            var kicker = client == null
                ? "HALO HUD"
                : !string.IsNullOrEmpty(client.LastError)
                    ? "ERROR"
                    : demo
                        ? "DEMO MODE · MOCK CREWS ARE NOT LIVE GPS"
                        : client.IsLive
                            ? "LIVE GPS · SOURCE OF TRUTH"
                            : "CONNECTING";
            GUI.Label(new Rect(24, 20, 536, 22), kicker, _chip);
            if (client == null)
                GUI.Label(new Rect(24, 44, 536, 48), "Assign HaloApiClient", _title);
            else if (!string.IsNullOrEmpty(client.LastError))
                GUI.Label(new Rect(24, 44, 536, 56), client.LastError, _body);
            else if (client.IsLive && twin?.summary != null)
            {
                GUI.Label(new Rect(24, 42, 536, 28), twin.propertyName ?? "Thornbury", _title);
                var snap = siteRenderer != null && siteRenderer.lastSnappedToBuilding > 0
                    ? $"  ·  {siteRenderer.lastSnappedToBuilding} at bldg (GPS off Chase Oaks)"
                    : "";
                GUI.Label(new Rect(24, 70, 536, 40),
                    $"{twin.summary.headline}\nLive {liveCount}  ·  Demo {demoCount}  ·  Densest Bldg {siteRenderer?.densestBuilding}{snap}   D demo   F densest   drag orbit",
                    _body);
            }
            else
                GUI.Label(new Rect(24, 44, 536, 48), "Thornbury · acquiring plate…", _body);

            if (client != null && client.config != null && GUI.Button(new Rect(12, 12 + top + 8, 180, 32), demo ? "Hide demo" : "Thornbury demo", demo ? _demoBtn : _btn))
            {
                client.config.thornburyDemo = !client.config.thornburyDemo;
                client.FetchOnce();
            }
            if (siteRenderer != null && GUI.Button(new Rect(200, 12 + top + 8, 140, 32), "Focus densest", _btn))
                siteRenderer.FocusDensest();

            GUI.Box(new Rect(12, Screen.height - 52, 420, 40), GUIContent.none, _bar);
            GUI.Label(new Rect(24, Screen.height - 44, 400, 24), "● Live GPS     ◆ DEMO / MOCK — not a check-in", _body);

            if (twin?.presence == null || twin.presence.Count == 0) return;
            var rosterH = Mathf.Min(360f, 28 + twin.presence.Count * 28f);
            var rosterY = 12 + top + 48;
            GUI.Box(new Rect(Screen.width - 312, rosterY, 300, rosterH), GUIContent.none, _bar);
            GUI.Label(new Rect(Screen.width - 300, rosterY + 8, 276, 20), "ON SITE", _chip);
            _scroll = GUI.BeginScrollView(new Rect(Screen.width - 300, rosterY + 28, 280, rosterH - 36), _scroll, new Rect(0, 0, 260, twin.presence.Count * 26f));
            var y = 0f;
            foreach (var p in twin.presence)
            {
                if (!p.onSite) continue;
                var mock = IsDemoCrew(p);
                var label = (mock ? "[DEMO] " : "") + (string.IsNullOrEmpty(p.crewName) ? p.crewId : p.crewName);
                var unit = string.IsNullOrEmpty(p.unitNo) ? (p.building > 0 ? $"Bldg {p.building}" : "") : $"Unit {p.unitNo}";
                if (GUI.Button(new Rect(0, y, 260, 24), $"{label}  {unit}", _row) && siteRenderer != null && p.building > 0)
                    siteRenderer.FocusBuilding(p.building);
                y += 26f;
            }
            GUI.EndScrollView();
        }

        bool IsDemo()
        {
            return client != null && (
                (client.config != null && client.config.thornburyDemo) ||
                (client.Last?.summary != null && client.Last.summary.demoActive) ||
                (client.Last?.demo != null && client.Last.demo.active));
        }

        static bool IsDemoCrew(CrewPresence c)
        {
            if (c == null) return false;
            if (c.demo) return true;
            if (!string.IsNullOrEmpty(c.source) && c.source == "demo") return true;
            return !string.IsNullOrEmpty(c.crewId) && c.crewId.StartsWith("demo:");
        }

        void EnsureStyles()
        {
            if (_bar != null) return;
            _bar = new GUIStyle(GUI.skin.box)
            {
                fontSize = 13,
                alignment = TextAnchor.UpperLeft,
                padding = new RectOffset(10, 10, 8, 8),
            };
            _title = new GUIStyle(GUI.skin.label) { fontSize = 18, fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
            _body = new GUIStyle(GUI.skin.label) { fontSize = 13, normal = { textColor = new Color(0.92f, 0.93f, 0.9f) }, wordWrap = true };
            _chip = new GUIStyle(GUI.skin.label) { fontSize = 11, fontStyle = FontStyle.Bold, normal = { textColor = new Color(0.706f, 1f, 0.267f) } };
            _btn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold };
            _demoBtn = new GUIStyle(GUI.skin.button) { fontSize = 13, fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
            _row = new GUIStyle(GUI.skin.button) { fontSize = 12, alignment = TextAnchor.MiddleLeft, fontStyle = FontStyle.Bold };
        }
    }
}
