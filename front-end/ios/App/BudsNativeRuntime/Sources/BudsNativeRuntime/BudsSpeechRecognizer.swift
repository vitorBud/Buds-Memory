import AVFoundation
import Foundation
import Speech

public final class BudsSpeechRecognizer: @unchecked Sendable {
    public typealias UpdateHandler = @Sendable (_ transcript: String, _ isFinal: Bool, _ volume: Double) -> Void

    private let stateLock = NSLock()
    private static let captureLock = NSLock()
    private static var captureActive = false
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var latestTranscript = ""
    private var updateHandler: UpdateHandler?
    private var tapInstalled = false
    private var operationId: String?
    private var bargeInMode = false
    private var lastVolumeEmitUptime: TimeInterval = 0

    public static var isCapturing: Bool {
        captureLock.lock()
        defer { captureLock.unlock() }
        return captureActive
    }

    public init() {}

    public func start(
        operationId: String,
        localeIdentifier: String = "pt-BR",
        bargeIn: Bool = false,
        onUpdate: @escaping UpdateHandler
    ) async throws {
        let authorization = await Self.requestAuthorization()
        guard authorization == .authorized else {
            throw NSError(
                domain: "BudsSpeech",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Permita o reconhecimento de fala nos Ajustes do iPhone."]
            )
        }

        try await MainActor.run {
            self.stopOnMainActor(deactivateSession: false)
            self.stateLock.lock()
            self.latestTranscript = ""
            self.updateHandler = onUpdate
            self.operationId = operationId
            self.bargeInMode = bargeIn
            self.lastVolumeEmitUptime = 0
            self.stateLock.unlock()

            let audioSession = AVAudioSession.sharedInstance()
            // O app nativo trabalha em half-duplex. Uma sessão somente de
            // gravação evita criar VoiceProcessingIO enquanto o reconhecedor
            // está ativo, eliminando os render err -1 vistos no aparelho.
            try audioSession.setCategory(
                .record,
                mode: .measurement,
                options: [.allowBluetooth, .duckOthers]
            )
            try? audioSession.setPreferredIOBufferDuration(0.02)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)),
                  recognizer.isAvailable else {
                throw NSError(
                    domain: "BudsSpeech",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "O reconhecimento de fala não está disponível agora."]
                )
            }
            guard recognizer.supportsOnDeviceRecognition else {
                throw NSError(
                    domain: "BudsSpeech",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "O reconhecimento de fala local não está disponível neste iPhone. Nenhum áudio foi enviado à nuvem."]
                )
            }

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = true
            if #available(iOS 16.0, *) {
                request.addsPunctuation = true
            }

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw NSError(
                    domain: "BudsSpeech",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "O microfone não forneceu um formato de áudio válido."]
                )
            }

            self.recognitionRequest = request
            self.audioEngine = engine
            self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                self.stateLock.lock()
                let isCurrent = self.operationId == operationId
                self.stateLock.unlock()
                guard isCurrent else { return }
                if let result {
                    let transcript = result.bestTranscription.formattedString
                    self.stateLock.lock()
                    self.latestTranscript = transcript
                    let handler = self.updateHandler
                    self.stateLock.unlock()
                    // O nível real chega pelo tap do microfone. Não fabricar
                    // volume junto da transcrição: isso podia transformar o
                    // eco textual do próprio TTS em uma interrupção válida.
                    handler?(transcript, result.isFinal, 0)
                } else if error != nil {
                    self.stateLock.lock()
                    let handler = self.updateHandler
                    let transcript = self.latestTranscript
                    self.stateLock.unlock()
                    handler?(transcript, true, 0)
                }
            }

            input.installTap(onBus: 0, bufferSize: 1_024, format: format) { [weak self] buffer, _ in
                request.append(buffer)
                self?.emitVolume(from: buffer, operationId: operationId)
            }
            self.tapInstalled = true
            engine.prepare()
            try engine.start()
            Self.setCaptureActive(true)
            onUpdate("", false, 0)
        }
    }

    public func stop(operationId: String) async -> String {
        await MainActor.run {
            self.stateLock.lock()
            let isCurrent = self.operationId == operationId
            self.stateLock.unlock()
            guard isCurrent else { return "" }
            let transcript = self.currentTranscript
            self.stopOnMainActor(deactivateSession: !self.bargeInMode)
            return transcript
        }
    }

    public func cancel(operationId: String?) async {
        await MainActor.run {
            self.stateLock.lock()
            guard operationId == nil || self.operationId == operationId else {
                self.stateLock.unlock()
                return
            }
            self.latestTranscript = ""
            self.stateLock.unlock()
            self.stopOnMainActor(deactivateSession: !self.bargeInMode)
        }
    }

    private var currentTranscript: String {
        stateLock.lock()
        defer { stateLock.unlock() }
        return latestTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private func stopOnMainActor(deactivateSession: Bool = true) {
        if tapInstalled, let audioEngine {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        tapInstalled = false
        audioEngine?.stop()
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        stateLock.lock()
        updateHandler = nil
        operationId = nil
        bargeInMode = false
        stateLock.unlock()
        Self.setCaptureActive(false)
        if deactivateSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private static func setCaptureActive(_ active: Bool) {
        captureLock.lock()
        captureActive = active
        captureLock.unlock()
    }

    private func emitVolume(from buffer: AVAudioPCMBuffer, operationId: String) {
        guard let samples = buffer.floatChannelData?.pointee else { return }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return }
        var sum: Float = 0
        for index in 0..<count {
            let sample = samples[index]
            sum += sample * sample
        }
        let rms = sqrt(sum / Float(count))
        // RMS linear do iPhone costuma ser muito pequeno (0.0001...0.01).
        // Converter para uma escala logarítmica entrega um nível estável ao
        // detector JS sem depender do ganho específico de cada aparelho.
        let decibels = 20 * log10(max(Double(rms), 0.000_001))
        let volume = min(1, max(0, (decibels + 62) / 42))
        let uptime = ProcessInfo.processInfo.systemUptime
        stateLock.lock()
        guard self.operationId == operationId,
              uptime - lastVolumeEmitUptime >= 0.08 else {
            stateLock.unlock()
            return
        }
        lastVolumeEmitUptime = uptime
        let handler = updateHandler
        stateLock.unlock()
        // Texto só é emitido pelo callback do SFSpeechRecognizer. Repeti-lo a
        // cada buffer de volume inundava a bridge Capacitor dezenas de vezes
        // por segundo e mantinha a WebView ocupada sem informação nova.
        handler?("", false, volume)
    }

    private static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }
}
