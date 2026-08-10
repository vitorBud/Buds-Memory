import CoreLocation
import Foundation

/// Core Location é usado em dois modos distintos:
/// - uma leitura precisa e única quando o usuário abre/atualiza o mapa;
/// - mudanças significativas + geofences quando o modo econômico está ativo.
/// - GPS preciso contínuo somente durante um trajeto iniciado pelo usuário.
public final class BudsLocationMonitor: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    public typealias SampleHandler = @Sendable (
        Double, Double, Double?, Double?, Double?, String, String
    ) throws -> BudsLocationStateRecord
    public typealias RegionHandler = @Sendable (Int64, Bool) throws -> Void

    private let manager = CLLocationManager()
    private let onSample: SampleHandler
    private let onRegion: RegionHandler
    private let lock = NSLock()
    private var pending: CheckedContinuation<BudsLocationStateRecord, Error>?
    private var cachedPlaces: [BudsKnownPlaceRecord] = []
    private var routeTracking = false
    private let defaultsKey = "buds-location-monitoring-enabled-v1"

    public init(onSample: @escaping SampleHandler, onRegion: @escaping RegionHandler) {
        self.onSample = onSample
        self.onRegion = onRegion
        super.init()
        manager.delegate = self
        manager.activityType = .other
        manager.pausesLocationUpdatesAutomatically = true
        manager.distanceFilter = 250
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    public var monitoringEnabled: Bool {
        UserDefaults.standard.bool(forKey: defaultsKey)
    }

    public var authorizationName: String {
        switch manager.authorizationStatus {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "when_in_use"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "unknown"
        }
    }

    public func requestCurrentLocation() async throws -> BudsLocationStateRecord {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.main.async {
                self.lock.lock()
                if let previous = self.pending {
                    previous.resume(throwing: Self.error("Uma atualização de localização já está em andamento."))
                }
                self.pending = continuation
                self.lock.unlock()

                switch self.manager.authorizationStatus {
                case .denied, .restricted:
                    self.finish(.failure(Self.error("Permita o acesso à localização nos Ajustes do iPhone.")))
                case .notDetermined:
                    self.manager.requestWhenInUseAuthorization()
                default:
                    self.manager.desiredAccuracy = kCLLocationAccuracyBest
                    self.manager.requestLocation()
                }
            }
        }
    }

    public func configure(enabled: Bool, places: [BudsKnownPlaceRecord]) {
        // Persiste antes de agendar o trabalho na main queue para que a ponte
        // Capacitor reflita o novo estado imediatamente na interface.
        UserDefaults.standard.set(enabled, forKey: defaultsKey)
        DispatchQueue.main.async {
            self.cachedPlaces = places.filter(\.enabled)
            if enabled {
                if self.manager.authorizationStatus == .notDetermined || self.manager.authorizationStatus == .authorizedWhenInUse {
                    self.manager.requestAlwaysAuthorization()
                }
                self.applyLowEnergyMonitoring()
            } else {
                self.manager.stopMonitoringSignificantLocationChanges()
                self.manager.monitoredRegions.forEach { self.manager.stopMonitoring(for: $0) }
            }
        }
    }

    public func refreshRegions(_ places: [BudsKnownPlaceRecord]) {
        guard monitoringEnabled else { return }
        configure(enabled: true, places: places)
    }

    public func startRouteTracking() {
        DispatchQueue.main.async {
            self.routeTracking = true
            self.manager.activityType = .fitness
            self.manager.pausesLocationUpdatesAutomatically = true
            self.manager.distanceFilter = 12
            self.manager.desiredAccuracy = kCLLocationAccuracyBest
            switch self.manager.authorizationStatus {
            case .notDetermined:
                self.manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                self.manager.allowsBackgroundLocationUpdates = true
                self.manager.showsBackgroundLocationIndicator = true
                self.manager.startUpdatingLocation()
            default:
                break
            }
        }
    }

    public func stopRouteTracking() {
        DispatchQueue.main.async {
            self.routeTracking = false
            self.manager.stopUpdatingLocation()
            self.manager.allowsBackgroundLocationUpdates = false
            self.manager.showsBackgroundLocationIndicator = false
            self.manager.activityType = .other
            self.manager.distanceFilter = 250
            self.manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            self.applyLowEnergyMonitoring()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            lock.lock()
            let hasPending = pending != nil
            lock.unlock()
            if hasPending {
                manager.desiredAccuracy = kCLLocationAccuracyBest
                manager.requestLocation()
            }
            if routeTracking {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
                manager.startUpdatingLocation()
            }
            if monitoringEnabled && manager.authorizationStatus == .authorizedWhenInUse {
                manager.requestAlwaysAuthorization()
            }
            applyLowEnergyMonitoring()
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            finish(.failure(Self.error("A localização foi negada nos Ajustes do iPhone.")))
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        do {
            let source = routeTracking ? "route" : (pending == nil ? "significant_change" : "core_location")
            let state = try onSample(
                location.coordinate.latitude,
                location.coordinate.longitude,
                location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil,
                location.verticalAccuracy >= 0 ? location.altitude : nil,
                location.speed >= 0 ? location.speed : nil,
                ISO8601DateFormatter().string(from: location.timestamp),
                source
            )
            if !routeTracking {
                manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            }
            finish(.success(state))
        } catch {
            finish(.failure(error))
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(.failure(error))
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let id = Self.placeId(region.identifier) else { return }
        try? onRegion(id, true)
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        guard let id = Self.placeId(region.identifier) else { return }
        try? onRegion(id, false)
    }

    private func applyLowEnergyMonitoring() {
        guard monitoringEnabled, manager.authorizationStatus == .authorizedAlways else { return }
        manager.startMonitoringSignificantLocationChanges()
        manager.monitoredRegions.forEach { manager.stopMonitoring(for: $0) }
        for place in cachedPlaces.prefix(20) {
            let center = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
            let radius = min(place.radiusMeters, manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(center: center, radius: radius, identifier: "buds-place-\(place.id)")
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
        }
    }

    private func finish(_ result: Result<BudsLocationStateRecord, Error>) {
        lock.lock()
        let continuation = pending
        pending = nil
        lock.unlock()
        continuation?.resume(with: result)
    }

    private static func placeId(_ identifier: String) -> Int64? {
        guard identifier.hasPrefix("buds-place-") else { return nil }
        return Int64(identifier.dropFirst("buds-place-".count))
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "BudsLocation", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
