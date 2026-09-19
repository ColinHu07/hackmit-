import SwiftUI

/// Displays the exact oriented camera frame used for these hand observations.
struct PhoneCameraPreview: View {
    let frame: PhoneCameraFrame?
    let running: Bool
    private let chains = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12],
                          [9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17]]
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { _ in
            if let frame, running, ProcessInfo.processInfo.systemUptime - frame.receivedAt < 0.6 {
                VStack(alignment: .leading, spacing: 8) {
                    GeometryReader { _ in
                        ZStack {
                            Image(decorative: frame.image, scale: 1, orientation: .up)
                                .resizable().interpolation(.medium)
                            Canvas { context, size in
                                for hand in frame.hands where hand.points.count == 21 {
                                    func position(_ index: Int) -> CGPoint {
                                        let p = hand.points[index]
                                        return CGPoint(x: p.x * size.width, y: p.y * size.height)
                                    }
                                    for chain in chains {
                                        var path = Path()
                                        for (i, joint) in chain.enumerated() {
                                            if i == 0 { path.move(to: position(joint)) }
                                            else { path.addLine(to: position(joint)) }
                                        }
                                        context.stroke(path, with: .color(.green), lineWidth: 2)
                                    }
                                    for index in hand.points.indices {
                                        let p = position(index), r: CGFloat = index == 8 ? 5 : 2.5
                                        context.fill(Path(ellipseIn: CGRect(x: p.x-r, y: p.y-r, width: r*2, height: r*2)),
                                                     with: .color(index == 8 ? .white : .green))
                                    }
                                }
                            }
                        }
                    }
                    .aspectRatio(CGFloat(frame.image.width) / CGFloat(frame.image.height), contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Live glasses camera with hand landmarks")
                    Text("Glasses camera · \(frame.hands.count) hand(s) · Index fingertip marked in white")
                        .font(.caption)
                }
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "eyeglasses").font(.largeTitle)
                    Text(running ? "Waiting for fresh glasses-camera frames…" : "Start the glasses camera to see your view and tracked hands.")
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: 180)
                .foregroundStyle(.secondary)
            }
        }
    }
}
