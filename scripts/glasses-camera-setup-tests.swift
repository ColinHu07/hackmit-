import Foundation

@main
struct CameraSetupTests {
    static func main() throws {
        let server = URL(string: "https://game.example")!
        func link(_ query: String, prefix: String = "bondimals://quest-camera?") -> URL {
            URL(string: prefix + query)!
        }
        func rejects(_ url: URL, _ message: String) {
            do { _ = try QuestCameraSetupLink(url, trustedServer: server); fatalError(message) }
            catch { }
        }
        let valid = try QuestCameraSetupLink(link("server=https%3A%2F%2Fgame.example&code=abcd2345"), trustedServer: server)
        precondition(valid.code == "ABCD2345")
        precondition(valid.server == server)
        let defaultPort = try QuestCameraSetupLink(link("server=https%3A%2F%2FGAME.example%3A443%2F&code=ABCD2345"), trustedServer: server)
        precondition(defaultPort.server == server)
        rejects(link("server=https%3A%2F%2Fevil.example&code=ABCD2345"), "must reject a different camera-upload server")
        rejects(link("server=http%3A%2F%2Fgame.example&code=ABCD2345"), "must require TLS")
        rejects(link("server=https%3A%2F%2Fuser%3Apass%40game.example&code=ABCD2345"), "must reject server credentials")
        rejects(link("server=https%3A%2F%2Fgame.example%2Fplay&code=ABCD2345"), "must reject a non-origin server path")
        rejects(link("server=https%3A%2F%2Fgame.example%3Fredirect%3Devil&code=ABCD2345"), "must reject server queries")
        rejects(link("server=https%3A%2F%2Fgame.example%23fragment&code=ABCD2345"), "must reject server fragments")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345&code=ABCD6789"), "must reject duplicate code")
        rejects(link("server=https%3A%2F%2Fgame.example&server=https%3A%2F%2Fevil.example&code=ABCD2345"), "must reject duplicate server")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345&next=https%3A%2F%2Fevil.example"), "must reject unknown fields")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345#secret"), "must reject link fragment")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345", prefix: "other://quest-camera?"), "must reject another scheme")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345", prefix: "bondimals://user@quest-camera?"), "must reject link credentials")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD2345", prefix: "bondimals://quest-camera/other?"), "must reject extra path")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD01IO"), "must reject invalid code alphabet")
        rejects(link("server=https%3A%2F%2Fgame.example&code=ABCD23"), "must reject short code")
        print("Camera setup: 2 accepted links and 15 invalid/untrusted links passed.")
    }
}
