import SwiftUI

@main
struct RRScanApp: App {
    @StateObject private var model = ScanModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { model.handle(url: $0) }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var model: ScanModel
    @State private var newType: RoomType = .bedroom
    @State private var newName = ""
    @State private var shareItem: ShareItem?
    @State private var shareError: String?

    var body: some View {
        NavigationStack {
            List {
                if !ScanModel.isSupported {
                    Section {
                        Label("This device has no LiDAR sensor. Use an iPhone Pro (12 Pro or newer) or an iPad Pro.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                if model.uploadURL == nil && model.planned.isEmpty {
                    Section {
                        Text("Open a unit in RentReadies, go to 3D map → 3D scan, and tap **LiDAR scan**. RR Scan opens with that unit's rooms and sends the scan back by itself.\n\nYou can also scan here on your own and share the file.")
                            .font(.callout)
                    }
                }

                if !model.planned.isEmpty {
                    Section("Rooms in \(model.unitName.isEmpty ? "this unit" : model.unitName)") {
                        ForEach(model.planned) { room in
                            HStack {
                                Text(room.type.icon)
                                Text(room.name)
                                Spacer()
                                if model.isScanned(room) {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                    Button("Rescan") { model.start(room) }.buttonStyle(.bordered)
                                } else {
                                    Button("Scan") { model.start(room) }.buttonStyle(.borderedProminent)
                                }
                            }
                            .disabled(!ScanModel.isSupported)
                        }
                    }
                }

                Section("Add a room") {
                    Picker("Type", selection: $newType) {
                        ForEach(RoomType.allCases) { Text("\($0.icon) \($0.label)").tag($0) }
                    }
                    TextField("Name (optional)", text: $newName)
                    Button("Scan this room") {
                        let name = newName.trimmingCharacters(in: .whitespaces)
                        let sameType = model.planned.filter { $0.type == newType }.count
                        let finalName = name.isEmpty ? (sameType > 0 ? "\(newType.label) \(sameType + 1)" : newType.label) : name
                        model.start(PlannedRoom(name: finalName, type: newType))
                        newName = ""
                    }
                    .disabled(!ScanModel.isSupported)
                }

                if !model.scanned.isEmpty {
                    Section {
                        ForEach(model.scanned) { room in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(room.type.icon) \(room.name)").font(.body.weight(.semibold))
                                Text(summary(room)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .onDelete { idx in idx.map { model.scanned[$0] }.forEach(model.remove) }
                    } header: {
                        Text("Scanned (\(model.scanned.count))")
                    } footer: {
                        Text("Scan rooms one after another without closing the app, so they line up with each other.")
                    }
                }

                if !model.scanned.isEmpty {
                    Section {
                        if model.uploadURL != nil {
                            Button {
                                Task { await model.send() }
                            } label: {
                                HStack {
                                    Text(model.sendState == .sent ? "Sent ✓" : "Send to RentReadies (\(model.scanned.reduce(0) { $0 + $1.photos.count }) photos)")
                                    Spacer()
                                    if model.sendState == .sending { ProgressView() }
                                }
                            }
                            .disabled(model.sendState == .sending || model.sendState == .sent)
                        }
                        Button("Share scan file…") {
                            do { shareItem = ShareItem(url: try model.exportFile()) } catch { shareError = error.localizedDescription }
                        }
                        if model.sendState == .sent {
                            Text("Done. Switch back to RentReadies; it imports the scan by itself.").font(.callout).foregroundStyle(.green)
                        }
                        if case .failed(let message) = model.sendState {
                            Text("Couldn't send: \(message)").font(.callout).foregroundStyle(.red)
                        }
                        if let shareError {
                            Text(shareError).font(.callout).foregroundStyle(.red)
                        }
                    } footer: {
                        if let next = model.nextRoom {
                            Text("Not scanned yet: \(next.name)\(model.planned.filter { !model.isScanned($0) }.count > 1 ? " and others" : ""). You can still send what you have.")
                        }
                    }
                }
            }
            .navigationTitle("RR Scan")
            .fullScreenCover(item: $model.capturing) { room in
                CaptureView(room: room).environmentObject(model)
            }
            .sheet(item: $shareItem) { item in
                ShareSheet(items: [item.url])
            }
        }
    }

    private func summary(_ room: ScannedRoom) -> String {
        let c = room.captured
        let objects = c.objects.map { String(describing: $0.category) }
        var parts = ["\(room.photos.count) photos", "\(c.walls.count) walls", "\(c.doors.count) doors", "\(c.windows.count) windows"]
        let appliances = Set(objects).subtracting(["storage", "chair", "table", "sofa", "bed", "television", "stairs"])
        if !appliances.isEmpty { parts.append(appliances.sorted().joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }
}

struct ShareItem: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
