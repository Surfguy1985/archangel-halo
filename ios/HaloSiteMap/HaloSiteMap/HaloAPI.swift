import Foundation

struct Plate: Codable {
    let ok: Bool
    let propertyId: String?
    let propertyName: String?
    let site: Site?
    let summary: Summary?
    let buildings: [Building]
    let presence: [Presence]
    let units: [UnitRow]?
    let moneyTint: [MoneyTint]?
    let turnRadar: [TurnRadar]?
    let photoBillboards: [PhotoBillboard]?
    let selection: Selection?
}

struct Site: Codable { let lat: Double; let lng: Double }
struct Summary: Codable {
    let headline: String?
    let onSite: Int?
    let liveJobs: Int?
    let overdueTurns: Int?
    let photoCount: Int?
}
struct Building: Codable {
    let building: Int
    let label: String?
    let lat: Double
    let lng: Double
    let unitCount: Int?
    let risk: String?
    let openTurns: Int?
    let riskLabel: String?
}
struct Presence: Codable {
    let crewId: String?
    let crewName: String?
    let lat: Double?
    let lng: Double?
    let onSite: Bool
    let building: Int?
    let title: String?
    let unitNo: String?
    let jobId: String?
}
struct UnitRow: Codable {
    let unitNo: String
    let building: Int?
    let status: String
    let jobId: String
    let jobNo: String?
}
struct MoneyTint: Codable {
    let building: Int
    let risk: String
    let openTurns: Int
    let openDiscrepancies: Int
    let label: String
}
struct TurnRadar: Codable {
    let jobId: String
    let jobNo: String?
    let unitNo: String?
    let building: Int?
    let status: String
    let ageHours: Double
    let risk: String
    let lat: Double?
    let lng: Double?
}
struct PhotoBillboard: Codable {
    let id: String
    let unitNo: String?
    let building: Int?
    let phase: String?
    let note: String?
    let storagePath: String?
    let lat: Double?
    let lng: Double?
}
struct Selection: Codable {
    let building: Int?
    let unitNo: String?
    let jobId: String?
    let crewId: String?
    let source: String?
}

final class HaloAPI {
    static let shared = HaloAPI()
    var apiBase = "https://archangel-halo.replit.app"
    var propertyId = "49dec4b1-1dc5-4b59-8025-0c0bc14d35ce"

    func fetchPlate() async throws -> Plate {
        let url = URL(string: "\(apiBase)/api/properties/\(propertyId)/building-ops")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(Plate.self, from: data)
    }

    func setSelection(building: Int?, unitNo: String?, jobId: String?, source: String = "mapkit") async {
        guard let url = URL(string: "\(apiBase)/api/properties/\(propertyId)/selection") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any?] = [
            "building": building,
            "unitNo": unitNo,
            "jobId": jobId,
            "source": source,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })
        _ = try? await URLSession.shared.data(for: req)
    }
}
