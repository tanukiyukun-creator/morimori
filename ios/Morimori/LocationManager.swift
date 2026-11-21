import Foundation
import CoreLocation

@MainActor
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var isSharing = false
    @Published private(set) var authorization = CLAuthorizationStatus.notDetermined
    @Published private(set) var lastUpdate: Date?
    @Published private(set) var lastError: String?

    private let manager = CLLocationManager()
    private var userId: String?

    override init() {
        super.init()

        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 25
        manager.activityType = .other
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true

        authorization = manager.authorizationStatus
    }

    func configure(userId: String) {
        self.userId = userId
    }

    func startSharing() {
        guard userId != nil else {
            lastError = "アカウントを先に設定してください。"
            return
        }

        lastError = nil
        isSharing = true
        manager.requestAlwaysAuthorization()

        if manager.authorizationStatus == .authorizedAlways ||
            manager.authorizationStatus == .authorizedWhenInUse {
            manager.startUpdatingLocation()
        }
    }

    func stopSharing() {
        isSharing = false
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus

        if isSharing &&
            (authorization == .authorizedAlways ||
             authorization == .authorizedWhenInUse) {
            manager.startUpdatingLocation()
        }

        if authorization == .denied || authorization == .restricted {
            isSharing = false
            lastError = "iPadの設定で位置情報を許可してください。"
        }
    }

    func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard isSharing,
              let userId,
              let location = locations.last else {
            return
        }

        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        lastUpdate = Date()

        Task {
            do {
                try await NativeAPI.shared.sendLocation(
                    userId: userId,
                    latitude: latitude,
                    longitude: longitude
                )
            } catch {
                lastError = "位置情報の送信に失敗しました。"
            }
        }
    }

    func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        lastError = error.localizedDescription
    }
}
