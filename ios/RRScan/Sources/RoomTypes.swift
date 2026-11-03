import Foundation

/// Same room types as the web app (`RoomType` in src/lib/types.ts).
enum RoomType: String, CaseIterable, Identifiable, Codable {
    case kitchen, bathroom, bedroom, living, dining, hallway, laundry, closet, entry, garage, exterior, utility, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .kitchen: return "Kitchen"
        case .bathroom: return "Bathroom"
        case .bedroom: return "Bedroom"
        case .living: return "Living room"
        case .dining: return "Dining room"
        case .hallway: return "Hallway"
        case .laundry: return "Laundry"
        case .closet: return "Closet"
        case .entry: return "Entry"
        case .garage: return "Garage"
        case .exterior: return "Exterior / balcony"
        case .utility: return "Utility / mechanical"
        case .other: return "Other room"
        }
    }

    var icon: String {
        switch self {
        case .kitchen: return "🍳"
        case .bathroom: return "🛁"
        case .bedroom: return "🛏️"
        case .living: return "🛋️"
        case .dining: return "🍽️"
        case .hallway: return "🚪"
        case .laundry: return "🧺"
        case .closet: return "👕"
        case .entry: return "🔑"
        case .garage: return "🚗"
        case .exterior: return "🌳"
        case .utility: return "🔧"
        case .other: return "📦"
        }
    }
}
