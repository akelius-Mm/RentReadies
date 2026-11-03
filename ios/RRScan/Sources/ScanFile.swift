import Foundation
import RoomPlan
import simd

// The file RR Scan sends to RentReadies. Must match `RRScan` in src/lib/types.ts.
// Meters, y up, one shared coordinate space for every room in the unit.
// `transform` is a 4x4 matrix in column-major order; `dimensions` is [width, height, depth].

struct RRSurface: Codable {
    var transform: [Float]
    var dimensions: [Float]
}

struct RRObject: Codable {
    var category: String
    var transform: [Float]
    var dimensions: [Float]
}

/// A photo from the walk-through. Must match `RRScanPhoto` in src/lib/types.ts.
struct RRPhoto: Codable {
    var id: String
    var kind: String          // object | auto | manual
    var label: String
    var category: String?
    var jpeg: String          // base64, portrait
    var width: Int
    var height: Int
    var camera: [Float]       // camera-to-world 4x4, column-major (ARKit camera space, landscape sensor)
    var intrinsics: [Float]   // 3x3, column-major, sensor pixels
    var sensor: [Float]       // [width, height] of the landscape sensor image
}

struct RRRoom: Codable {
    var name: String
    var type: String
    var photos: [RRPhoto]
    var walls: [RRSurface]
    var doors: [RRSurface]
    var windows: [RRSurface]
    var openings: [RRSurface]
    var objects: [RRObject]
}

struct RRScanFile: Codable {
    var format = "rentreadies-roomplan"
    var version = 1
    var createdAt: String
    var unitName: String?
    var device: String?
    var rooms: [RRRoom]
}

extension simd_float4x4 {
    /// Column-major, the order three.js `Matrix4.fromArray` expects.
    var flat: [Float] {
        [columns.0, columns.1, columns.2, columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }
}

extension simd_float3x3 {
    /// Column-major.
    var flat: [Float] {
        [columns.0, columns.1, columns.2].flatMap { [$0.x, $0.y, $0.z] }
    }
}

extension simd_float3 {
    var array: [Float] { [x, y, z] }
}

extension RRRoom {
    init(name: String, type: String, captured room: CapturedRoom, photos: [RoomPhoto]) {
        func surface(_ s: CapturedRoom.Surface) -> RRSurface {
            RRSurface(transform: s.transform.flat, dimensions: s.dimensions.array)
        }
        self.name = name
        self.type = type
        self.photos = photos.map {
            RRPhoto(
                id: $0.id.uuidString,
                kind: $0.kind.rawValue,
                label: $0.label,
                category: $0.category,
                jpeg: $0.jpeg.base64EncodedString(),
                width: $0.width,
                height: $0.height,
                camera: $0.camera.flat,
                intrinsics: $0.intrinsics.flat,
                sensor: [Float($0.sensor.width), Float($0.sensor.height)]
            )
        }
        walls = room.walls.map(surface)
        doors = room.doors.map(surface)
        windows = room.windows.map(surface)
        openings = room.openings.map(surface)
        // Category names come out as "refrigerator", "stove", "washerDryer", ...
        objects = room.objects.map {
            RRObject(category: String(describing: $0.category), transform: $0.transform.flat, dimensions: $0.dimensions.array)
        }
    }
}
