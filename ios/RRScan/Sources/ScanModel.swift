import Foundation
import ARKit
import RoomPlan
import UIKit

struct PlannedRoom: Identifiable, Hashable, Codable {
    var id = UUID()
    var name: String
    var type: RoomType
}

struct ScannedRoom: Identifiable {
    let id = UUID()
    var name: String
    var type: RoomType
    var captured: CapturedRoom
    var photos: [RoomPhoto]
}

@MainActor
final class ScanModel: ObservableObject {
    /// Rooms the web app asked for, in order. Empty when RR Scan was opened by itself.
    @Published var planned: [PlannedRoom] = []
    @Published var scanned: [ScannedRoom] = []
    @Published var unitName: String = ""
    /// Where to send the finished scan (from the RentReadies link).
    @Published var uploadURL: URL?

    /// The room being scanned right now (drives the full-screen capture view).
    @Published var capturing: PlannedRoom?
    @Published var sendState: SendState = .idle

    enum SendState: Equatable {
        case idle, sending, sent, failed(String)
    }

    /// One AR session for the whole unit, so every room lands in the same coordinate space
    /// and the rooms line up with each other in RentReadies.
    let arSession = ARSession()

    static var isSupported: Bool { RoomCaptureSession.isSupported }

    // MARK: Link from RentReadies
    // rentreadies-scan://scan?upload=<https url>&unit=<name>&rooms=<json [{name,type}]>

    func handle(url: URL) {
        guard url.scheme == "rentreadies-scan",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return }
        let value = { (name: String) in items.first(where: { $0.name == name })?.value }

        if let raw = value("upload"), let u = URL(string: raw), u.scheme == "https" || u.host == "localhost" || isLocalNetwork(u) {
            uploadURL = u
        }
        unitName = value("unit") ?? ""
        if let json = value("rooms"), let data = json.data(using: .utf8),
           let list = try? JSONDecoder().decode([LinkRoom].self, from: data) {
            planned = list.map { PlannedRoom(name: $0.name, type: RoomType(rawValue: $0.type) ?? .other) }
        }
        scanned = []
        sendState = .idle
    }

    private struct LinkRoom: Decodable {
        let name: String
        let type: String
    }

    private func isLocalNetwork(_ u: URL) -> Bool {
        guard let host = u.host else { return false }
        return host.hasSuffix(".local") || host.hasPrefix("192.168.") || host.hasPrefix("10.") || host.hasSuffix(".ts.net")
    }

    // MARK: Scanning

    func isScanned(_ room: PlannedRoom) -> Bool {
        scanned.contains { $0.name.caseInsensitiveCompare(room.name) == .orderedSame }
    }

    func start(_ room: PlannedRoom) {
        capturing = room
    }

    /// Keep a finished room. Scanning the same room again replaces the earlier scan.
    func save(_ captured: CapturedRoom, photos: [RoomPhoto], for room: PlannedRoom) {
        scanned.removeAll { $0.name.caseInsensitiveCompare(room.name) == .orderedSame }
        scanned.append(ScannedRoom(name: room.name, type: room.type, captured: captured, photos: photos))
        if !planned.contains(where: { $0.name.caseInsensitiveCompare(room.name) == .orderedSame }) {
            planned.append(room)
        }
        capturing = nil
        sendState = .idle
    }

    func remove(_ room: ScannedRoom) {
        scanned.removeAll { $0.id == room.id }
    }

    var nextRoom: PlannedRoom? { planned.first { !isScanned($0) } }

    // MARK: Output

    func buildFile() -> RRScanFile {
        RRScanFile(
            createdAt: ISO8601DateFormatter().string(from: Date()),
            unitName: unitName.isEmpty ? nil : unitName,
            device: UIDevice.current.model,
            rooms: scanned.map { RRRoom(name: $0.name, type: $0.type.rawValue, captured: $0.captured, photos: $0.photos) }
        )
    }

    func encoded() throws -> Data {
        try JSONEncoder().encode(buildFile())
    }

    /// Write the scan to a file for the share sheet (AirDrop, Save to Files, ...).
    func exportFile() throws -> URL {
        let safe = (unitName.isEmpty ? "unit" : unitName).replacingOccurrences(of: "[^A-Za-z0-9 _-]", with: "", options: .regularExpression)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe) LiDAR scan.json")
        try encoded().write(to: url, options: .atomic)
        return url
    }

    func send() async {
        guard let uploadURL else { return }
        sendState = .sending
        do {
            var req = URLRequest(url: uploadURL)
            req.httpMethod = "PUT"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoded()
            req.timeoutInterval = 600 // scans carry photos; allow slow mobile uploads
            let (data, response) = try await URLSession.shared.data(for: req)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) {
                sendState = .sent
            } else {
                let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "Server error \(status)"
                sendState = .failed(message)
            }
        } catch {
            sendState = .failed(error.localizedDescription)
        }
    }

    private struct ServerError: Decodable {
        let error: String
    }
}
