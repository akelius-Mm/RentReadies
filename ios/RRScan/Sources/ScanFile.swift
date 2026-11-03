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

struct RRRoom: Codable {
    var name: String
    var type: String
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

extension simd_float3 {
    var array: [Float] { [x, y, z] }
}

extension RRRoom {
    init(name: String, type: String, captured room: CapturedRoom) {
        func surface(_ s: CapturedRoom.Surface) -> RRSurface {
            RRSurface(transform: s.transform.flat, dimensions: s.dimensions.array)
        }
        self.name = name
        self.type = type
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
