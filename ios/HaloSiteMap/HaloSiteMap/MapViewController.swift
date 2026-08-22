import UIKit
import MapKit

/// Priority 1: MapKit shell — buildings, crew, units, money tint, turn radar.
final class MapViewController: UIViewController, MKMapViewDelegate, UITableViewDataSource, UITableViewDelegate {
    private let mapView = MKMapView()
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private let headline = UILabel()
    private var plate: Plate?
    private var unitRows: [UnitRow] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Halo Site"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Refresh", style: .plain, target: self, action: #selector(reload))

        headline.font = .preferredFont(forTextStyle: .subheadline)
        headline.textColor = .secondaryLabel
        headline.numberOfLines = 2
        headline.translatesAutoresizingMaskIntoConstraints = false

        mapView.translatesAutoresizingMaskIntoConstraints = false
        mapView.delegate = self
        mapView.pointOfInterestFilter = .excludingAll

        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self
        table.delegate = self
        table.register(UITableViewCell.self, forCellReuseIdentifier: "u")

        view.addSubview(headline)
        view.addSubview(mapView)
        view.addSubview(table)

        NSLayoutConstraint.activate([
            headline.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            headline.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            headline.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            mapView.topAnchor.constraint(equalTo: headline.bottomAnchor, constant: 8),
            mapView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            mapView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mapView.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.48),
            table.topAnchor.constraint(equalTo: mapView.bottomAnchor),
            table.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            table.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            table.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        reload()
        Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in self?.reload() }
    }

    @objc private func reload() {
        Task {
            do {
                let p = try await HaloAPI.shared.fetchPlate()
                await MainActor.run { self.apply(p) }
            } catch {
                await MainActor.run { self.headline.text = "Offline: \(error.localizedDescription)" }
            }
        }
    }

    private func apply(_ p: Plate) {
        plate = p
        headline.text = "\(p.propertyName ?? "Property") · \(p.summary?.headline ?? "")"
        unitRows = p.units ?? []
        table.reloadData()
        mapView.removeAnnotations(mapView.annotations)

        for b in p.buildings {
            let a = RiskAnnotation()
            a.coordinate = .init(latitude: b.lat, longitude: b.lng)
            a.title = b.riskLabel ?? b.label ?? "Bldg \(b.building)"
            a.subtitle = "\(b.openTurns ?? 0) open turns · \(b.risk ?? "clean")"
            a.risk = b.risk ?? "clean"
            a.building = b.building
            mapView.addAnnotation(a)
        }
        for c in p.presence where c.onSite {
            guard let lat = c.lat, let lng = c.lng else { continue }
            let a = MKPointAnnotation()
            a.coordinate = .init(latitude: lat, longitude: lng)
            a.title = c.crewName
            a.subtitle = c.title
            mapView.addAnnotation(a)
        }
        for t in p.turnRadar ?? [] where t.risk != "ok" {
            guard let lat = t.lat, let lng = t.lng else { continue }
            let a = MKPointAnnotation()
            a.coordinate = .init(latitude: lat, longitude: lng)
            a.title = "Turn \(t.unitNo ?? t.jobNo ?? "")"
            a.subtitle = "\(t.risk) · \(t.ageHours)h"
            mapView.addAnnotation(a)
        }

        if let s = p.site {
            let region = MKCoordinateRegion(center: .init(latitude: s.lat, longitude: s.lng),
                                            latitudinalMeters: 700, longitudinalMeters: 700)
            mapView.setRegion(region, animated: true)
        }
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation { return nil }
        let id = "pin"
        let v = mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
            ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
        v.annotation = annotation
        v.canShowCallout = true
        if let r = annotation as? RiskAnnotation {
            switch r.risk {
            case "hot": v.markerTintColor = .systemRed
            case "watch": v.markerTintColor = .systemOrange
            default: v.markerTintColor = .systemTeal
            }
        } else {
            v.markerTintColor = .systemYellow
        }
        return v
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        guard let r = view.annotation as? RiskAnnotation else { return }
        Task { await HaloAPI.shared.setSelection(building: r.building, unitNo: nil, jobId: nullIfNeeded()) }
    }

    private func nullIfNeeded() -> String? { nil }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { unitRows.count }
    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { "Units / turns" }
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "u", for: indexPath)
        let u = unitRows[indexPath.row]
        var cfg = cell.defaultContentConfiguration()
        cfg.text = "Unit \(u.unitNo)" + (u.building != nil ? " · Bldg \(u.building!)" : "")
        cfg.secondaryText = "\(u.status) · \(u.jobNo ?? u.jobId.prefix(8).description)"
        cell.contentConfiguration = cfg
        return cell
    }
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let u = unitRows[indexPath.row]
        Task {
            await HaloAPI.shared.setSelection(building: u.building, unitNo: u.unitNo, jobId: u.jobId)
            if let b = plate?.buildings.first(where: { $0.building == u.building }) {
                let c = CLLocationCoordinate2D(latitude: b.lat, longitude: b.lng)
                mapView.setRegion(MKCoordinateRegion(center: c, latitudinalMeters: 250, longitudinalMeters: 250), animated: true)
            }
        }
    }
}

final class RiskAnnotation: MKPointAnnotation {
    var risk: String = "clean"
    var building: Int = 0
}
