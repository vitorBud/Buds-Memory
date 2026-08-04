import AVFoundation
import Foundation
import Speech

public final class AetherSpeechRecognizer: @unchecked Sendable {
    public typealias UpdateHandler = @Sendable (_ transcript: String, _ isFinal: Bool, _ volume: Double) -> Void

    private let stateLock = NSLock()
    private var audioEngine: AVAudioEngine?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var latestTranscript = ""
    private var updateHandler: UpdateHandler?
    private var tapInstalled = false
    private var operationId: String?

    public init() {}

    public func start(
        operationId: String,
        localeIdentifier: String = "pt-BR",
        onUpdate: @escaping UpdateHandler
    ) async throws {
        let authorization = await Self.requestAuthorization()
        guard authorization == .authorized else {
            throw NSError(
                domain: "AetherSpeech",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Permita o reconhecimento de fala nos Ajustes do iPhone."]
            )
        }

        try await MainActor.run {
            self.stopOnMainActor()
            self.stateLock.lock()
            self.latestTranscript = ""
            self.updateHandler = onUpdate
            self.operationId = operationId
            self.stateLock.unlock()

            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)),
                  recognizer.isAvailable else {
                throw NSError(
                    domain: "AetherSpeech",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "O reconhecimento de fala não está disponível agora."]
                )
            }

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
            if #available(iOS 16.0, *) {
                request.addsPunctuation = true
            }

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw NSError(
                    domain: "AetherSpeech",
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
                    handler?(transcript, result.isFinal, 0.22)
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
            self.stopOnMainActor()
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
            self.stopOnMainActor()
        }
    }

    private var currentTranscript: String {
        stateLock.lock()
        defer { stateLock.unlock() }
        return latestTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private func stopOnMainActor() {
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
        stateLock.unlock()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
        let volume = min(1, max(0, Double(rms) * 9))
        stateLock.lock()
        guard self.operationId == operationId else {
            stateLock.unlock()
            return
        }
        let handler = updateHandler
        let transcript = latestTranscript
        stateLock.unlock()
        handler?(transcript, false, volume)
    }

    private static func requestAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }
}
