import SwiftUI
import ARKit
import RoomPlan

/// Full-screen LiDAR capture of one room using Apple's RoomPlan.
struct CaptureView: View {
    @EnvironmentObject var model: ScanModel
    let room: PlannedRoom

    @StateObject private var controller = CaptureController()
    @StateObject private var sampler = PhotoSampler()

    var body: some View {
        ZStack(alignment: .top) {
            RoomCaptureContainer(controller: controller, arSession: model.arSession)
                .ignoresSafeArea()

            VStack(spacing: 6) {
                HStack {
                    Button("Cancel") {
                        sampler.stop()
                        controller.stop()
                        model.capturing = nil
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                    Text("\(room.type.icon) \(room.name)")
                        .font(.headline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.ultraThinMaterial, in: Capsule())
                    Spacer()

                    switch controller.phase {
                    case .scanning:
                        Button("Done") {
                            sampler.stop()
                            controller.stop()
                        }
                        .buttonStyle(.borderedProminent)
                    case .processing:
                        ProgressView()
                    case .finished:
                        Button("Save room") {
                            if let result = controller.result {
                                model.save(result, photos: sampler.select(for: result), for: room)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    case .failed:
                        EmptyView()
                    }
                }
                .padding(.horizontal)

                if controller.phase == .scanning {
                    Text("Walk the room slowly and pause briefly on each wall, appliance, sink, toilet and tub — photos are taken when you hold still. Use the shutter for close-ups (under sinks, inside the oven, model labels).")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .padding(8)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal)
                }
                if case .failed(let message) = controller.phase {
                    VStack(spacing: 8) {
                        Text("Scan failed: \(message)").font(.footnote)
                        Button("Close") { model.capturing = nil }.buttonStyle(.bordered)
                    }
                    .padding(10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.top, 8)

            if controller.phase == .scanning {
                VStack {
                    Spacer()
                    HStack(alignment: .center) {
                        Text("📷 \(sampler.candidateCount) frames")
                            .font(.footnote.monospacedDigit())
                            .padding(8)
                            .background(.ultraThinMaterial, in: Capsule())
                        Spacer()
                        Button {
                            sampler.takeManual()
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        } label: {
                            Circle()
                                .strokeBorder(.white, lineWidth: 4)
                                .background(Circle().fill(.white.opacity(0.35)))
                                .frame(width: 72, height: 72)
                        }
                        .accessibilityLabel("Take close-up photo")
                        Spacer()
                        Text("\(sampler.manualCount) close-ups")
                            .font(.footnote.monospacedDigit())
                            .padding(8)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 30)
                }
            }
        }
        .onAppear {
            controller.start()
            sampler.start(session: model.arSession)
        }
        .onDisappear { sampler.stop() }
        .statusBarHidden()
    }
}

@MainActor
final class CaptureController: ObservableObject {
    enum Phase: Equatable {
        case scanning, processing, finished, failed(String)
    }

    @Published var phase: Phase = .scanning
    @Published var result: CapturedRoom?
    weak var view: RoomCaptureView?
    private var started = false

    func start() {
        guard let view, !started else { return }
        started = true
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    /// Stop scanning but keep the AR session running so the next room shares its coordinates.
    func stop() {
        guard phase == .scanning else { return }
        phase = .processing
        view?.captureSession.stop(pauseARSession: false)
    }

    func finished(_ room: CapturedRoom, _ error: Error?) {
        // RoomPlan can report a warning alongside a usable model; keep the model if it has walls.
        if error == nil || !room.walls.isEmpty {
            result = room
            phase = .finished
        } else {
            phase = .failed(error?.localizedDescription ?? "No room was captured.")
        }
    }
}

struct RoomCaptureContainer: UIViewRepresentable {
    let controller: CaptureController
    let arSession: ARSession

    func makeCoordinator() -> CaptureDelegate {
        CaptureDelegate(controller: controller)
    }

    func makeUIView(context: Context) -> RoomCaptureView {
        let view = RoomCaptureView(frame: .zero, arSession: arSession)
        view.delegate = context.coordinator
        controller.view = view
        Task { @MainActor in controller.start() }
        return view
    }

    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

/// RoomCaptureViewDelegate inherits NSCoding, hence the coder methods.
final class CaptureDelegate: NSObject, RoomCaptureViewDelegate {
    private weak var controller: CaptureController?

    init(controller: CaptureController) {
        self.controller = controller
        super.init()
    }

    required init?(coder: NSCoder) {
        nil
    }

    func encode(with coder: NSCoder) {}

    /// Let RoomPlan build the final model and show its preview.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        let controller = controller
        Task { @MainActor in
            controller?.finished(processedResult, error)
        }
    }
}
