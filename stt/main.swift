import AVFoundation
import Speech
import Foundation

// ── JSON output helpers ──────────────────────────────────────────────────────

func emit(_ dict: [String: String]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          var line = String(data: data, encoding: .utf8) else { return }
    line.append("\n")
    // Broadcast to all connected IPC clients (best-effort), and also mirror to
    // stdout for debugging when run directly from a terminal.
    SocketServer.broadcast(line)
    line.data(using: .utf8)?.withUnsafeBytes { buf in
        guard let base = buf.baseAddress else { return }
        Darwin_write(STDOUT_FILENO, base, line.utf8.count)
    }
    Darwin_fsync(STDOUT_FILENO)
}

@inline(__always) private func Darwin_write(_ fd: Int32, _ p: UnsafeRawPointer, _ n: Int) {
    var remaining = n
    var ptr = p
    while remaining > 0 {
        let written = write(fd, ptr, remaining)
        if written <= 0 {
            if errno == EINTR { continue }
            break
        }
        remaining -= written
        ptr = ptr.advanced(by: written)
    }
}

@inline(__always) private func Darwin_fsync(_ fd: Int32) {
    fsync(fd)
}

func emitStatus(_ state: String, _ message: String? = nil) {
    var dict = ["type": "status", "state": state] as [String: String]
    if let message { dict["message"] = message }
    emit(dict)
}

// ── Speech transcriber ───────────────────────────────────────────────────────

final class Transcriber {
    private let engine = AVAudioEngine()
    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var listening = false
    private var authorized = false

    init(localeId: String) {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId))
    }

    /// Request mic + speech authorization up front. Result is cached and also
    /// emitted as a status line so the frontend knows whether STT can run.
    func authorize(completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            guard speechStatus == .authorized else {
                self.authorized = false
                emitStatus("denied", "speech recognition not authorized")
                completion(false)
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { micGranted in
                self.authorized = micGranted
                if micGranted {
                    emitStatus("authorized")
                } else {
                    emitStatus("denied", "microphone not authorized")
                }
                completion(micGranted)
            }
        }
    }

    func start() {
        guard !listening else { return }
        guard let recognizer, recognizer.isAvailable else {
            emitStatus("error", "recognizer unavailable")
            return
        }

        // If we are not yet authorized, request first; only then actually start.
        // This avoids starting the audio engine without mic permission, which
        // would crash (SIGABRT) or run silently with no input on modern macOS.
        if !authorized {
            authorize { [weak self] granted in
                guard granted else { return }
                DispatchQueue.main.async { self?.begin(recognizer: recognizer) }
            }
            return
        }
        begin(recognizer: recognizer)
    }

    private func begin(recognizer: SFSpeechRecognizer) {
        // Guard: refuse to touch the audio engine if we don't actually have mic
        // permission. Accessing engine.inputNode / engine.start() without it
        // throws an Objective-C exception that Swift cannot catch (-> SIGABRT).
        if SFSpeechRecognizer.authorizationStatus() != .authorized {
            emitStatus("denied", "speech recognition not authorized")
            return
        }
        let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if micStatus != .authorized {
            emitStatus("denied", "microphone not authorized")
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true
        }

        // Boost comprehension for common voice commands and terms used in the app.
        // This significantly improves accuracy for mixed Italian/English commands
        // like "in pi run", "tile terminals", "focus claude", "apri browser" etc.
        req.contextualStrings = [
            // Italian
            "terminale", "browser", "tile", "uccidi", "riavvia", "focus", "seleziona",
            "apri", "chiudi", "invia", "prompt", "scrivi", "esegui", "annulla",
            // English / CLI names
            "pi", "claude", "codex", "cursor", "shell", "terminal",
            "kill", "restart", "focus", "select", "send", "prompt", "write", "run",
            "tile terminals", "kill all", "undo",
            // Common folder/project hints
            "progetto", "folder", "cartella"
        ]
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        // Larger buffer reduces callback frequency → better performance / lower CPU while keeping latency acceptable for live caption.
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak req] buffer, _ in
            req?.append(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            emitStatus("error", "audio engine: \(error.localizedDescription)")
            cleanup()
            return
        }

        listening = true
        emitStatus("listening")

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                emit(["type": result.isFinal ? "final" : "partial", "text": text])
                if result.isFinal { self?.restartTap() }
            }
            if let error {
                emitStatus("error", error.localizedDescription)
                self?.stop()
            }
        }
    }

    func stop() {
        guard listening else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        task?.cancel()
        listening = false
        emitStatus("stopped")
        cleanup()
    }

    private func restartTap() {
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel()
        task = nil
        listening = false
        start()
    }

    private func cleanup() {
        request = nil
        task = nil
    }
}

// ── Socket server (IPC with the Node sidecar) ────────────────────────────────
//
// The .app is launched by the sidecar via `open` (LaunchServices) so that macOS
// shows the microphone TCC prompt. `open` does not expose the child's stdio, so
// we communicate over a Unix domain socket instead: clients write `start` /
// `stop` / `quit` lines, the server broadcasts one JSON object per line to all
// connected clients.

final class SocketServer {
    /// Currently connected client fds. Guarded by the lock.
    private static var clients: [Int32] = []
    private static let lock = NSLock()

    static func add(_ fd: Int32) {
        lock.lock(); defer { lock.unlock() }
        clients.append(fd)
    }

    static func remove(_ fd: Int32) {
        lock.lock(); defer { lock.unlock() }
        clients.removeAll { $0 == fd }
        close(fd)
    }

    /// Send a line to every connected client. Dead clients are pruned.
    static func broadcast(_ line: String) {
        guard let data = line.data(using: .utf8) else { return }
        lock.lock()
        let snapshot = clients
        lock.unlock()
        var dead: [Int32] = []
        data.withUnsafeBytes { buf in
            guard let base = buf.baseAddress else { return }
            for fd in snapshot {
                var remaining = data.count
                var ptr = base
                var failed = false
                while remaining > 0 {
                    let written = write(fd, ptr, remaining)
                    if written <= 0 {
                        if errno == EINTR { continue }
                        failed = true
                        break
                    }
                    remaining -= written
                    ptr = ptr.advanced(by: written)
                }
                if failed { dead.append(fd) }
            }
        }
        if !dead.isEmpty {
            lock.lock()
            clients.removeAll { dead.contains($0) }
            lock.unlock()
            for fd in dead { close(fd) }
        }
    }
}

let socketPath = ProcessInfo.processInfo.environment["OHCANVAS_STT_SOCKET"]
    ?? "/tmp/ohcanvas-stt-\(getuid()).sock"

// Clean up any stale socket from a previous run.
unlink(socketPath)

func argumentValue(_ name: String) -> String? {
    let args = ProcessInfo.processInfo.arguments
    for (index, value) in args.enumerated() {
        if value == name, index + 1 < args.count {
            return args[index + 1]
        }
        if value.hasPrefix("\(name)=") {
            return String(value.dropFirst(name.count + 1))
        }
    }
    return nil
}

let localeId = argumentValue("--locale")
    ?? ProcessInfo.processInfo.environment["STT_LOCALE"]
    ?? "it-IT"
let transcriber = Transcriber(localeId: localeId)

// One-shot auth-check mode: used by the sidecar to pre-authorize TCC before
// spawning the streaming server. Exit 0 on granted, 1 on denied.
if ProcessInfo.processInfo.arguments.contains("--check-auth") {
    transcriber.authorize { granted in
        exit(granted ? 0 : 1)
    }
    RunLoop.main.run()
}

func runServer() {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
        emitStatus("error", "could not create socket")
        exit(1)
    }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = socketPath.utf8CString
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) { dest in
            pathBytes.withUnsafeBufferPointer { src in
                _ = strncpy(dest, src.baseAddress!, pathBytes.count)
            }
        }
    }

    let bindResult = withUnsafePointer(to: &addr) { addrPtr in
        addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            bind(fd, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard bindResult == 0 else {
        emitStatus("error", "bind failed: \(String(cString: strerror(errno)))")
        close(fd)
        exit(1)
    }
    guard listen(fd, 4) == 0 else {
        emitStatus("error", "listen failed: \(String(cString: strerror(errno)))")
        close(fd)
        exit(1)
    }
    chmod(socketPath, 0o600)

    emit(["type": "socket", "path": socketPath])

    // Accept loop on a background queue.
    let acceptQueue = DispatchQueue(label: "ohcanvas.stt.accept")
    acceptQueue.async {
        while true {
            let client = accept(fd, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                continue
            }
            SocketServer.add(client)
            // Read commands from this client, one line at a time.
            DispatchQueue.global().async {
                readCommands(from: client)
            }
        }
    }
}

/// Read newline-delimited commands from a client socket fd.
func readCommands(from client: Int32) {
    let chunk = 256
    var buf = [UInt8](repeating: 0, count: chunk)
    var buffer = [UInt8]()
    while true {
        let n = buf.withUnsafeMutableBufferPointer { read(client, $0.baseAddress!, chunk) }
        if n <= 0 { SocketServer.remove(client); return }
        for i in 0..<n {
            let byte = buf[i]
            if byte == 0x0A { // newline
                let line = String(bytes: buffer, encoding: .utf8) ?? ""
                handleCommand(line.trimmingCharacters(in: .whitespaces))
                buffer.removeAll(keepingCapacity: true)
            } else {
                buffer.append(byte)
            }
        }
    }
}

func handleCommand(_ cmd: String) {
    switch cmd {
    case "start": DispatchQueue.main.async { transcriber.start() }
    case "stop": DispatchQueue.main.async { transcriber.stop() }
    case "quit": exit(0)
    default: break
    }
}

// Request authorization at launch; result is cached for `start`.
transcriber.authorize { _ in }
runServer()
emitStatus("ready")
RunLoop.main.run()
