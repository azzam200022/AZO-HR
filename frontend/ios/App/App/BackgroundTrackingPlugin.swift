import Capacitor
import CoreLocation
import Foundation
import WebKit

private struct PendingLocation: Codable {
    let eventID: String
    let employeeID: String
    let lat: Double
    let lng: Double
    let observedAtMs: Int64
    let accuracyM: Double?

    enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case employeeID = "employee_id"
        case lat
        case lng
        case observedAtMs = "observed_at_ms"
        case accuracyM = "accuracy_m"
    }
}

@objc(BackgroundTrackingPlugin)
public class BackgroundTrackingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundTrackingPlugin"
    public let jsName = "BackgroundTracking"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestBackgroundPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
    ]

    private let locationManager = CLLocationManager()
    private let defaults = UserDefaults.standard
    private let queueLock = NSLock()
    private var permissionCall: CAPPluginCall?
    private var requestedAlwaysUpgrade = false
    private var permissionRequestID = 0
    private var flushInFlight = false
    private var lastAcceptedLocationAt: Date?

    private enum Key {
        static let active = "azo.backgroundLocation.active"
        static let manualStop = "azo.backgroundLocation.manualStop"
        static let apiBaseUrl = "azo.backgroundLocation.apiBaseUrl"
        static let employeeID = "azo.backgroundLocation.employeeID"
    }

    override public func load() {
        locationManager.delegate = self
        if defaults.bool(forKey: Key.active),
           locationManager.authorizationStatus == .authorizedAlways {
            beginLocationUpdates()
        }
    }

    @objc public func requestBackgroundPermissions(_ call: CAPPluginCall) {
        guard CLLocationManager.locationServicesEnabled() else {
            call.reject("فعّل خدمات الموقع من إعدادات الجهاز أولاً.")
            return
        }

        let status = locationManager.authorizationStatus
        if status == .authorizedAlways {
            call.resolve(["granted": true])
            return
        }
        if status == .denied || status == .restricted {
            call.resolve(["granted": false])
            return
        }

        permissionCall = call
        requestedAlwaysUpgrade = false
        permissionRequestID += 1
        let requestID = permissionRequestID
        if status == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        } else if status == .authorizedWhenInUse {
            requestedAlwaysUpgrade = true
            locationManager.requestAlwaysAuthorization()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self,
                  self.permissionRequestID == requestID,
                  let pendingCall = self.permissionCall else {
                return
            }
            self.permissionCall = nil
            pendingCall.resolve(["granted": self.locationManager.authorizationStatus == .authorizedAlways])
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        let apiBaseUrl = (call.getString("apiBaseUrl") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let employeeID = (call.getString("employeeId") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard URL(string: apiBaseUrl)?.scheme == "https", !employeeID.isEmpty else {
            call.reject("تعذر إعداد رابط الخادم أو حساب الموظف.")
            return
        }
        guard locationManager.authorizationStatus == .authorizedAlways else {
            call.reject("يلزم السماح لمواردي بالوصول إلى الموقع دائماً.")
            return
        }
        guard CLLocationManager.locationServicesEnabled() else {
            call.reject("خدمات الموقع متوقفة على الجهاز.")
            return
        }

        defaults.set(apiBaseUrl, forKey: Key.apiBaseUrl)
        defaults.set(employeeID, forKey: Key.employeeID)
        defaults.set(true, forKey: Key.active)
        defaults.set(false, forKey: Key.manualStop)
        lastAcceptedLocationAt = nil
        beginLocationUpdates()
        call.resolve(["active": true])
    }

    @objc public func stop(_ call: CAPPluginCall) {
        stopTracking(manual: call.getBool("manual") ?? false)
        call.resolve(["active": false])
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        call.resolve([
            "active": defaults.bool(forKey: Key.active),
            "manuallyStopped": defaults.bool(forKey: Key.manualStop),
        ])
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .authorizedAlways && defaults.bool(forKey: Key.active) {
            stopTracking(manual: false)
        }
        guard let call = permissionCall else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways:
            permissionCall = nil
            permissionRequestID += 1
            call.resolve(["granted": true])
        case .authorizedWhenInUse:
            if !requestedAlwaysUpgrade {
                requestedAlwaysUpgrade = true
                manager.requestAlwaysAuthorization()
            } else {
                permissionCall = nil
                permissionRequestID += 1
                call.resolve(["granted": false])
            }
        case .denied, .restricted:
            permissionCall = nil
            permissionRequestID += 1
            call.resolve(["granted": false])
        case .notDetermined:
            break
        @unknown default:
            permissionCall = nil
            permissionRequestID += 1
            call.resolve(["granted": false])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard defaults.bool(forKey: Key.active),
              let location = locations.last,
              location.horizontalAccuracy >= 0,
              let employeeID = defaults.string(forKey: Key.employeeID),
              !employeeID.isEmpty else {
            return
        }

        let now = Date()
        if let lastAcceptedLocationAt, now.timeIntervalSince(lastAcceptedLocationAt) < 5 {
            return
        }
        lastAcceptedLocationAt = now

        let sample = PendingLocation(
            eventID: UUID().uuidString,
            employeeID: employeeID,
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            observedAtMs: Int64(location.timestamp.timeIntervalSince1970 * 1000),
            accuracyM: location.horizontalAccuracy
        )
        append(sample)
        flushPending()
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Do not log coordinates, session cookies, or server URLs.
    }

    private func beginLocationUpdates() {
        guard locationManager.authorizationStatus == .authorizedAlways else { return }
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .other
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.startUpdatingLocation()
    }

    private func stopTracking(manual: Bool) {
        locationManager.stopUpdatingLocation()
        defaults.set(false, forKey: Key.active)
        defaults.set(manual, forKey: Key.manualStop)
        defaults.removeObject(forKey: Key.apiBaseUrl)
        defaults.removeObject(forKey: Key.employeeID)
    }

    private var queueURL: URL? {
        guard let supportDirectory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return nil
        }
        let directory = supportDirectory.appendingPathComponent("AzoBackgroundTracking", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
            return directory.appendingPathComponent("pending-locations.json")
        } catch {
            return nil
        }
    }

    private func queuedSamples() -> [PendingLocation] {
        queueLock.lock()
        defer { queueLock.unlock() }
        guard let queueURL, let data = try? Data(contentsOf: queueURL) else { return [] }
        return (try? JSONDecoder().decode([PendingLocation].self, from: data)) ?? []
    }

    private func saveQueue(_ samples: [PendingLocation]) {
        queueLock.lock()
        defer { queueLock.unlock() }
        guard let queueURL, let data = try? JSONEncoder().encode(samples) else { return }
        try? data.write(to: queueURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func append(_ sample: PendingLocation) {
        var samples = queuedSamples()
        samples.append(sample)
        saveQueue(samples)
    }

    private func deleteAcknowledged(_ identifiers: Set<String>) {
        guard !identifiers.isEmpty else { return }
        saveQueue(queuedSamples().filter { !identifiers.contains($0.eventID) })
    }

    private func flushPending() {
        guard defaults.bool(forKey: Key.active),
              !flushInFlight,
              let apiBaseUrl = defaults.string(forKey: Key.apiBaseUrl),
              let employeeID = defaults.string(forKey: Key.employeeID),
              let url = URL(string: "\(apiBaseUrl)/api/me/presence/batch"),
              let webView = bridge?.webView else {
            return
        }

        let batch = queuedSamples()
            .filter { $0.employeeID == employeeID }
            .sorted { $0.observedAtMs < $1.observedAtMs }
            .prefix(100)
        guard !batch.isEmpty else { return }
        flushInFlight = true

        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let matchingCookies = cookies.filter {
                $0.name == "hr_session" &&
                (url.host == $0.domain || url.host?.hasSuffix($0.domain) == true)
            }
            let cookieHeader = matchingCookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
            guard !cookieHeader.isEmpty else {
                DispatchQueue.main.async {
                    self.flushInFlight = false
                    self.stopTracking(manual: false)
                }
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 15
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(["samples": Array(batch)])

            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    self.flushInFlight = false
                    guard error == nil, let response = response as? HTTPURLResponse else { return }
                    if [401, 403, 404, 409].contains(response.statusCode) {
                        self.stopTracking(manual: false)
                        return
                    }
                    guard (200..<300).contains(response.statusCode),
                          let data,
                          let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        return
                    }

                    let acknowledged = Set(result["acknowledged_ids"] as? [String] ?? [])
                    self.deleteAcknowledged(acknowledged)
                    if result["checked_out"] as? Bool == true {
                        self.stopTracking(manual: false)
                    } else if !acknowledged.isEmpty {
                        self.flushPending()
                    }
                }
            }.resume()
        }
    }
}
