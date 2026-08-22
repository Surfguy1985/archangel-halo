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
        public TwinDemoFlag demo;
        public List<BuildingPin> buildings;
        public List<CrewPresence> presence;
        public List<HeatCell> heat;
        public List<UnitRow> units;
        public List<MoneyTint> moneyTint;
        public List<TurnRadarItem> turnRadar;
        public List<PhotoBillboard> photoBillboards;
        public SelectionState selection;
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
        public bool demoActive;
    }

    [Serializable]
    public class TwinDemoFlag
    {
        public bool active;
        public bool presentationOnly;
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
        public string risk;
        public int openTurns;
        public int openDiscrepancies;
        public string riskLabel;
    }

    [Serializable]
    public class MoneyTint
    {
        public int building;
        public string risk;
        public int openTurns;
        public int openDiscrepancies;
        public string label;
    }

    [Serializable]
    public class TurnRadarItem
    {
        public string jobId;
        public string jobNo;
        public string unitNo;
        public int building;
        public string status;
        public float ageHours;
        public string risk;
        public double lat;
        public double lng;
    }

    [Serializable]
    public class PhotoBillboard
    {
        public string id;
        public string jobId;
        public string unitNo;
        public int building;
        public string phase;
        public string note;
        public string storagePath;
        public double lat;
        public double lng;
        public string capturedAt;
    }

    [Serializable]
    public class SelectionState
    {
        public int building;
        public string unitNo;
        public string jobId;
        public string crewId;
        public string source;
    }

    [Serializable]
    public class CrewPresence
    {
        public string crewId;
        public string crewName;
        public string trade;
        public double lat;
        public double lng;
        public string at;
        public bool onSite;
        public int building;
        public string buildingLabel;
        public string confidence;
        public string jobId;
        public string jobNo;
        public string unitNo;
        public bool unitFromJob;
        public string title;
        public string source;
        public bool demo;
        public bool fresh;
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
