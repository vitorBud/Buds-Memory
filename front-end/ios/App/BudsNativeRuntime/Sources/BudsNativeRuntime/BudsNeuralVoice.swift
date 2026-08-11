import AVFoundation
import Foundation
import SherpaOnnxC

public enum BudsNeuralVoiceError: LocalizedError {
    case resourcesMissing
    case engineUnavailable
    case synthesisFailed
    case audioUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .resourcesMissing:
            return "Os arquivos da voz neural feminina não estão disponíveis neste app."
        case .engineUnavailable:
            return "A voz neural feminina não pôde ser carregada."
        case .synthesisFailed:
            return "A voz neural não conseguiu transformar esta resposta em áudio."
        case let .audioUnavailable(message):
            return "O áudio da voz neural não pôde ser iniciado: \(message)"
        }
    }
}

/// Sintetizador local do modo Voz. O texto chega em frases curtas enquanto o
/// 4B ainda está gerando, e o Kokoro entrega PCM incremental ao player nativo.
/// Uma única thread evita competir agressivamente com o LLM e reduz aquecimento.
public final class BudsNeuralVoice: @unchecked Sendable {
    public typealias StateHandler = @Sendable (_ state: String, _ message: String?) -> Void

    private struct Request {
        let text: String
        let epoch: UInt64
    }

    public var onStateChange: StateHandler?

    private let queue = DispatchQueue(label: "com.budsmemory.ios.neural-voice", qos: .userInitiated)
    private let cancellationLock = NSLock()
    private let audioEngine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var tts: OpaquePointer?
    private var sampleRate: Double = 24_000
    private var requests: [Request] = []
    private var epoch: UInt64 = 0
    private var activeCallbackEpoch: UInt64?
    private var synthesizing = false
    private var scheduledBuffers = 0
    private var audioPrepared = false
    private var releaseWorkItem: DispatchWorkItem?

    public init() {}

    deinit {
        releaseWorkItem?.cancel()
        player.stop()
        audioEngine.stop()
        if let tts { SherpaOnnxDestroyOfflineTts(tts) }
    }

    public func prepare(completion: @escaping @Sendable (Result<Void, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                try self.ensureTtsReady()
                completion(.success(()))
            } catch {
                self.emit("error", error.localizedDescription)
                completion(.failure(error))
            }
        }
    }

    public func enqueue(_ text: String) {
        let clean = Self.cleanText(text)
        guard !clean.isEmpty else { return }
        let requestEpoch = currentEpoch()
        queue.async { [weak self] in
            guard let self else { return }
            self.releaseWorkItem?.cancel()
            self.requests.append(Request(text: clean, epoch: requestEpoch))
            self.processNextIfNeeded()
        }
    }

    public func stop(releaseEngine: Bool = false) {
        // A geração do Sherpa ocupa a fila serial. Invalidar o epoch antes de
        // entrar nela permite que o callback C interrompa a frase em andamento.
        advanceEpoch()
        player.stop()
        queue.async { [weak self] in
            guard let self else { return }
            self.requests.removeAll()
            self.synthesizing = false
            self.activeCallbackEpoch = nil
            self.scheduledBuffers = 0
            self.player.stop()
            self.releaseWorkItem?.cancel()
            if releaseEngine { self.releaseResources() }
            self.emit("idle", nil)
        }
    }

    private func processNextIfNeeded() {
        guard !synthesizing, let request = requests.first else {
            finishIfIdle()
            return
        }
        requests.removeFirst()
        guard request.epoch == currentEpoch() else {
            processNextIfNeeded()
            return
        }

        do {
            try ensureReady()
        } catch {
            emit("error", error.localizedDescription)
            requests.removeAll()
            finishIfIdle()
            return
        }

        synthesizing = true
        activeCallbackEpoch = request.epoch
        let retained = Unmanaged.passUnretained(self).toOpaque()
        var generation = SherpaOnnxGenerationConfig()
        generation.silence_scale = 0.12
        generation.speed = 1.02
        generation.sid = 42 // pf_dora — voz feminina pt-BR do Kokoro 82M.
        generation.reference_audio = nil
        generation.reference_audio_len = 0
        generation.reference_sample_rate = 16_000
        generation.reference_text = nil
        generation.num_steps = 1
        generation.extra = nil

        let audio = request.text.withCString { textPointer in
            withUnsafePointer(to: &generation) { generationPointer in
                SherpaOnnxOfflineTtsGenerateWithConfig(
                    tts,
                    textPointer,
                    generationPointer,
                    Self.audioCallback,
                    retained
                )
            }
        }
        guard let audio else {
            activeCallbackEpoch = nil
            synthesizing = false
            requests.removeAll()
            emit("error", BudsNeuralVoiceError.synthesisFailed.localizedDescription)
            scheduleRelease()
            return
        }

        guard request.epoch == currentEpoch(),
              let samples = audio.pointee.samples,
              audio.pointee.n > 0 else {
            SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
            activeCallbackEpoch = nil
            synthesizing = false
            processNextIfNeeded()
            return
        }
        _ = consume(samples: samples, count: Int(audio.pointee.n))
        SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
        activeCallbackEpoch = nil
        synthesizing = false
        processNextIfNeeded()
    }

    private static let audioCallback: @convention(c) (
        UnsafePointer<Float>?, Int32, Float, UnsafeMutableRawPointer?
    ) -> Int32 = { _, _, _, context in
        guard let context else { return 0 }
        let voice = Unmanaged<BudsNeuralVoice>.fromOpaque(context).takeUnretainedValue()
        guard let callbackEpoch = voice.activeCallbackEpoch,
              callbackEpoch == voice.currentEpoch() else { return 0 }
        // O callback fica apenas como cancelamento cooperativo. Reproduzir o
        // PCM final de cada frase é mais estável no AVAudioEngine do iPhone.
        return 1
    }

    private func consume(samples: UnsafePointer<Float>, count: Int) -> Int32 {
        guard let callbackEpoch = activeCallbackEpoch,
              callbackEpoch == currentEpoch() else { return 0 }
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
              let channel = buffer.floatChannelData?[0] else { return 0 }
        buffer.frameLength = AVAudioFrameCount(count)
        channel.update(from: samples, count: count)

        scheduledBuffers += 1
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            self?.queue.async {
                guard let self else { return }
                self.scheduledBuffers = max(0, self.scheduledBuffers - 1)
                self.finishIfIdle()
            }
        }
        player.volume = 1
        audioEngine.mainMixerNode.outputVolume = 1
        if !player.isPlaying { player.play() }
        emit("speaking", nil)
#if DEBUG
        let sampleBuffer = UnsafeBufferPointer(start: samples, count: count)
        let peak = sampleBuffer.reduce(Float.zero) { max($0, abs($1)) }
        print("[Buds Voice] PCM agendado: \(count) amostras, pico \(peak), player=\(player.isPlaying), engine=\(audioEngine.isRunning)")
#endif
        return 1
    }

    private func ensureReady() throws {
        try ensureTtsReady()
        try prepareAudio()
    }

    private func ensureTtsReady() throws {
        if tts == nil {
            let created = try createTts()
            let engineSampleRate = SherpaOnnxOfflineTtsSampleRate(created)
            if engineSampleRate > 0 { sampleRate = Double(engineSampleRate) }
            tts = created
#if DEBUG
            print("[Buds Voice] Kokoro pronto: \(Int(sampleRate)) Hz, \(SherpaOnnxOfflineTtsNumSpeakers(created)) vozes")
#endif
        }
    }

    private func prepareAudio() throws {
        guard !audioPrepared else {
            if !audioEngine.isRunning { try audioEngine.start() }
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(
                .playAndRecord,
                mode: .spokenAudio,
                options: [.defaultToSpeaker, .allowBluetoothA2DP, .duckOthers]
            )
            try session.setPreferredSampleRate(sampleRate)
            try session.setActive(true)
            if session.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) {
                try session.overrideOutputAudioPort(.speaker)
            }
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: 1,
                interleaved: false
            ) else {
                throw BudsNeuralVoiceError.audioUnavailable("Formato PCM inválido.")
            }
            audioEngine.attach(player)
            audioEngine.connect(player, to: audioEngine.mainMixerNode, format: format)
            audioEngine.prepare()
            try audioEngine.start()
            audioPrepared = true
#if DEBUG
            let routes = session.currentRoute.outputs.map { "\($0.portName):\($0.portType.rawValue)" }.joined(separator: ", ")
            print("[Buds Voice] Saída ativa: \(routes), volume=\(session.outputVolume)")
#endif
        } catch {
            throw BudsNeuralVoiceError.audioUnavailable(error.localizedDescription)
        }
    }

    private func createTts() throws -> OpaquePointer {
        guard let directory = Bundle.module.url(forResource: "Kokoro", withExtension: nil),
              let model = Bundle.module.url(forResource: "model.int8", withExtension: "onnx", subdirectory: "Kokoro"),
              let voices = Bundle.module.url(forResource: "voices", withExtension: "bin", subdirectory: "Kokoro"),
              let tokens = Bundle.module.url(forResource: "tokens", withExtension: "txt", subdirectory: "Kokoro") else {
            throw BudsNeuralVoiceError.resourcesMissing
        }
        let dataDirectory = directory.appendingPathComponent("espeak-ng-data", isDirectory: true).path

        let created: OpaquePointer? = model.path.withCString { modelPointer in
            voices.path.withCString { voicesPointer in
                tokens.path.withCString { tokensPointer in
                    dataDirectory.withCString { dataPointer in
                        "pt-br".withCString { languagePointer in
                            "cpu".withCString { providerPointer in
                                var kokoro = SherpaOnnxOfflineTtsKokoroModelConfig()
                                kokoro.model = modelPointer
                                kokoro.voices = voicesPointer
                                kokoro.tokens = tokensPointer
                                kokoro.data_dir = dataPointer
                                kokoro.length_scale = 1
                                kokoro.dict_dir = nil
                                kokoro.lexicon = nil
                                kokoro.lang = languagePointer

                                var modelConfig = SherpaOnnxOfflineTtsModelConfig()
                                modelConfig.kokoro = kokoro
                                modelConfig.num_threads = 1
                                modelConfig.debug = 0
                                modelConfig.provider = providerPointer

                                var config = SherpaOnnxOfflineTtsConfig()
                                config.model = modelConfig
                                config.rule_fsts = nil
                                config.max_num_sentences = 1
                                config.rule_fars = nil
                                config.silence_scale = 0.12
                                return SherpaOnnxCreateOfflineTts(&config)
                            }
                        }
                    }
                }
            }
        }
        guard let created else { throw BudsNeuralVoiceError.engineUnavailable }
        return created
    }

    private func finishIfIdle() {
        guard !synthesizing, requests.isEmpty, scheduledBuffers == 0 else { return }
        emit("idle", nil)
        scheduleRelease()
    }

    private func scheduleRelease() {
        releaseWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.synthesizing, self.requests.isEmpty, self.scheduledBuffers == 0 else { return }
            self.releaseResources()
        }
        releaseWorkItem = work
        queue.asyncAfter(deadline: .now() + 35, execute: work)
    }

    private func releaseResources() {
        if let tts {
            SherpaOnnxDestroyOfflineTts(tts)
            self.tts = nil
        }
        if audioPrepared {
            player.stop()
            audioEngine.stop()
            audioEngine.detach(player)
            audioPrepared = false
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        }
    }

    private func emit(_ state: String, _ message: String?) {
        onStateChange?(state, message)
    }

    private func currentEpoch() -> UInt64 {
        cancellationLock.lock()
        defer { cancellationLock.unlock() }
        return epoch
    }

    private func advanceEpoch() {
        cancellationLock.lock()
        epoch &+= 1
        cancellationLock.unlock()
    }

    private static func cleanText(_ text: String) -> String {
        text
            .replacingOccurrences(of: "```[\\s\\S]*?```", with: " código omitido ", options: .regularExpression)
            .replacingOccurrences(of: "[`*_#>]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
