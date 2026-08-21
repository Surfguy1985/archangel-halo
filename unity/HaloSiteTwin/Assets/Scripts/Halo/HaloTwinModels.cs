using System;
using System.Collections.Generic;

namespace Halo.SiteTwin
{
    [Serializable]
    public class TwinResponse
    {
        public bool ok;
        public string mode;
        public string propertyId;
        public string propertyName;
        public SiteCenter site;
        public TwinSummary summary;
        public List<BuildingPin> buildings;
        public List<CrewPresence> presence;
        public List<HeatCell> heat;
        public List<UnitRow> units;
    }

    [Serializable]
    public class SiteCenter
    {
        public double lat;
        public double lng;
    }

    [Serializable]
    public class TwinSummary
    {
        public int buildings;
        public int crewsTracked;
        public int onSite;
        public int offSite;
        public int liveJobs;
        public string headline;
    }

    [Serializable]
    public class BuildingPin
    {
        public int building;
        public string label;
        public float x;
        public float y;
        public double lat;
        public double lng;
        public int unitCount;
    }

    [Serializable]
    public class CrewPresence
    {
        public string crewId;
        public string crewName;
        public double lat;
        public double lng;
        public bool onSite;
        public int building;
        public string buildingLabel;
        public string confidence;
        public string jobId;
        public string jobNo;
        public string unitNo;
        public bool unitFromJob;
        public string title;
    }

    [Serializable]
    public class HeatCell
    {
        public double lat;
        public double lng;
        public int weight;
        public int building;
    }

    [Serializable]
    public class UnitRow
    {
        public string unitNo;
        public int building;
        public string status;
        public string jobId;
        public string jobNo;
    }
}
