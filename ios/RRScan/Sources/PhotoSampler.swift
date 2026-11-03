import Foundation
import ARKit
import CoreImage
import ImageIO
import RoomPlan
import simd

/// A photo taken during the scan, with where the camera was so RentReadies can place problems in 3D.
struct RoomPhoto: Identifiable {
    let id = UUID()
    var kind: Kind
    var label: String
    var category: String?
    var jpeg: Data
    var width: Int
    var height: Int
    var camera: simd_float4x4
    var intrinsics: simd_float3x3
    var sensor: CGSize

    enum Kind: String { case object, auto, manual }
}

/// Saves sharp frames from the AR session while a room is being scanned, then picks
/// the best photo of each detected appliance/fixture plus overview shots in different directions.
@MainActor
final class PhotoSampler: ObservableObject {
    @Published private(set) var candidateCount = 0
    @Published private(set) var manualCount = 0

    private var candidates: [FrameCandidate] = []
    private var manual: [FrameCandidate] = []
    private var loop: Task<Void, Never>?
    private var lastPose: simd_float4x4?
    private var lastSaved: TimeInterval = 0
    private var encoding = false
    private weak var session: ARSession?

    // Tuning
    private let pollInterval: UInt64 = 250_000_000   // 0.25 s
    private let minGap: TimeInterval = 0.8            // between saved frames
    private let maxCandidates = 160
    private let maxAutoPhotos = 8
    private let maxSide: CGFloat = 1568               // same size the AI uses

    /// Appliances and fixtures worth their own photo.
    static let photoCategories: [String: String] = [
        "refrigerator": "Refrigerator",
        "stove": "Range / stove",
        "oven": "Oven",
        "dishwasher": "Dishwasher",
        "washerDryer": "Washer / dryer",
        "sink": "Sink",
        "toilet": "Toilet",
        "bathtub": "Tub / shower",
        "fireplace": "Fireplace",
    ]

    func start(session: ARSession) {
        self.session = session
        candidates = []
        manual = []
        candidateCount = 0
        manualCount = 0
        lastPose = nil
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: self?.pollInterval ?? 250_000_000)
                self?.tick()
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    /// Shutter button: save the current frame as a close-up.
    func takeManual() {
        guard let frame = session?.currentFrame else { return }
        let snapshot = FrameSnapshot(frame)
        Task.detached(priority: .userInitiated) {
            guard let c = FrameEncoder.encode(snapshot, maxSide: 1568) else { return }
            await MainActor.run {
                self.manual.append(c)
                self.manualCount = self.manual.count
            }
        }
    }

    private func tick() {
        guard let frame = session?.currentFrame else { return }
        guard case .normal = frame.camera.trackingState else { lastPose = nil; return }
        let pose = frame.camera.transform
        defer { lastPose = pose }
        // Only keep frames where the phone is nearly still, so they aren't blurry.
        guard let last = lastPose else { return }
        let (meters, degrees) = Self.moved(from: last, to: pose)
        guard meters < 0.03, degrees < 2.5 else { return }
        guard frame.timestamp - lastSaved >= minGap, candidates.count < maxCandidates, !encoding else { return }
        lastSaved = frame.timestamp
        encoding = true
        let snapshot = FrameSnapshot(frame)
        Task.detached(priority: .utility) {
            let c = FrameEncoder.encode(snapshot, maxSide: 1568)
            await MainActor.run {
                self.encoding = false
                if let c {
                    self.candidates.append(c)
                    self.candidateCount = self.candidates.count
                }
            }
        }
    }

    /// Pick photos for a finished room: best view of each detected object, overviews, and all close-ups.
    func select(for room: CapturedRoom) -> [RoomPhoto] {
        var result: [RoomPhoto] = []
        var used = Set<Int>()

        for object in room.objects {
            let category = String(describing: object.category)
            guard let label = Self.photoCategories[category] else { continue }
            let center = simd_make_float3(object.transform.columns.3)
            var best: (index: Int, score: Float)?
            for (i, c) in candidates.enumerated() {
                let s = Self.score(camera: c.camera, target: center)
                if s > 0, s > (best?.score ?? 0) { best = (i, s) }
            }
            if let best, !used.contains(best.index) {
                used.insert(best.index)
                result.append(photo(candidates[best.index], kind: .object, label: label, category: category))
            }
        }

        // Overviews: spread out by where the phone was and which way it pointed.
        var chosen = used.map { candidates[$0] }
        var autoCount = 0
        for (i, c) in candidates.enumerated() where !used.contains(i) && autoCount < maxAutoPhotos {
            if chosen.allSatisfy({ Self.distinct(c.camera, $0.camera) }) {
                chosen.append(c)
                autoCount += 1
                result.append(photo(c, kind: .auto, label: "Walk-through view", category: nil))
            }
        }

        result += manual.map { photo($0, kind: .manual, label: "Close-up", category: nil) }
        return result
    }

    private func photo(_ c: FrameCandidate, kind: RoomPhoto.Kind, label: String, category: String?) -> RoomPhoto {
        RoomPhoto(kind: kind, label: label, category: category, jpeg: c.jpeg, width: c.width, height: c.height,
                  camera: c.camera, intrinsics: c.intrinsics, sensor: c.sensor)
    }

    // MARK: Geometry

    private static func forward(_ m: simd_float4x4) -> simd_float3 {
        -simd_normalize(simd_make_float3(m.columns.2))   // camera looks down -Z
    }

    private static func position(_ m: simd_float4x4) -> simd_float3 {
        simd_make_float3(m.columns.3)
    }

    /// (meters moved, degrees turned)
    private static func moved(from a: simd_float4x4, to b: simd_float4x4) -> (Float, Float) {
        let dist = simd_distance(position(a), position(b))
        let cosAngle = max(-1, min(1, simd_dot(forward(a), forward(b))))
        return (dist, acos(cosAngle) * 180 / .pi)
    }

    /// How well a camera sees a point: in front, near the center of the view, not too close or far.
    private static func score(camera: simd_float4x4, target: simd_float3) -> Float {
        let toTarget = target - position(camera)
        let dist = simd_length(toTarget)
        guard dist > 0.5, dist < 4.0 else { return 0 }
        let cosAngle = simd_dot(simd_normalize(toTarget), forward(camera))
        guard cosAngle > cos(25 * Float.pi / 180) else { return 0 }
        let distanceFit = max(0, 1 - abs(dist - 1.6) / 3)
        return cosAngle * distanceFit
    }

    private static func distinct(_ a: simd_float4x4, _ b: simd_float4x4) -> Bool {
        let fa = forward(a), fb = forward(b)
        let yawA = atan2(fa.x, fa.z), yawB = atan2(fb.x, fb.z)
        var dYaw = abs(yawA - yawB) * 180 / .pi
        if dYaw > 180 { dYaw = 360 - dYaw }
        return dYaw >= 35 || simd_distance(position(a), position(b)) >= 1.2
    }
}

// MARK: - Frame encoding (off the main thread)

struct FrameCandidate {
    var jpeg: Data
    var width: Int
    var height: Int
    var camera: simd_float4x4
    var intrinsics: simd_float3x3
    var sensor: CGSize
    var time: TimeInterval
}

/// What we need from an ARFrame, copied so the frame itself isn't held (ARKit warns about retained frames).
struct FrameSnapshot: @unchecked Sendable {
    let image: CIImage
    let camera: simd_float4x4
    let intrinsics: simd_float3x3
    let sensor: CGSize
    let time: TimeInterval

    init(_ frame: ARFrame) {
        image = CIImage(cvPixelBuffer: frame.capturedImage)
        camera = frame.camera.transform
        intrinsics = frame.camera.intrinsics
        sensor = frame.camera.imageResolution
        time = frame.timestamp
    }
}

enum FrameEncoder {
    static let context = CIContext(options: [.cacheIntermediates: false])

    /// Portrait JPEG (sensor image rotated 90° clockwise), longest side at most `maxSide`.
    static func encode(_ s: FrameSnapshot, maxSide: CGFloat) -> FrameCandidate? {
        let portrait = s.image.oriented(.right)
        let moved = portrait.transformed(by: CGAffineTransform(translationX: -portrait.extent.minX, y: -portrait.extent.minY))
        let scale = min(1, maxSide / max(moved.extent.width, moved.extent.height))
        let scaled = moved.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let data = context.jpegRepresentation(
                  of: scaled, colorSpace: space,
                  options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.72])
        else { return nil }
        return FrameCandidate(jpeg: data, width: Int(scaled.extent.width.rounded()), height: Int(scaled.extent.height.rounded()),
                              camera: s.camera, intrinsics: s.intrinsics, sensor: s.sensor, time: s.time)
    }
}
