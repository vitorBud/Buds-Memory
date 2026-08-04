import Foundation
import llama

final class AetherInferenceEngine: @unchecked Sendable {
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var sampler: UnsafeMutablePointer<llama_sampler>?
    private var loadedModelPath = ""
    private let stateLock = NSLock()
    private var cancellationRequested = false
    private var backendInitialized = false

    deinit {
        unload()
        if backendInitialized {
            llama_backend_free()
        }
    }

    func cancel() {
        stateLock.lock()
        cancellationRequested = true
        stateLock.unlock()
    }

    func unload() {
        if let sampler {
            llama_sampler_free(sampler)
            self.sampler = nil
        }
        if let context {
            llama_free(context)
            self.context = nil
        }
        if let model {
            llama_model_free(model)
            self.model = nil
        }
        loadedModelPath = ""
    }

    func generate(
        prompt: String,
        modelURL: URL,
        onToken: @escaping @Sendable (String) -> Void
    ) throws -> AetherEngineResult {
        let totalStart = ProcessInfo.processInfo.systemUptime
        let startSnapshot = AetherPerformanceMonitor.snapshot()
        let thermalStart = Self.thermalStateName
        let loadStart = ProcessInfo.processInfo.systemUptime
        try prepareForGeneration(modelURL: modelURL)
        let loadMilliseconds = (ProcessInfo.processInfo.systemUptime - loadStart) * 1_000
        guard let model, let context, let sampler,
              let vocabulary = llama_model_get_vocab(model) else {
            throw AetherNativeError.modelLoad("runtime não inicializado")
        }

        stateLock.lock()
        cancellationRequested = false
        stateLock.unlock()
        llama_sampler_reset(sampler)
        llama_memory_clear(llama_get_memory(context), true)

        let maxOutput = generationTokenBudget()
        var promptTokens = try tokenizePreservingSystemPrompt(prompt, vocabulary: vocabulary)
        guard !promptTokens.isEmpty else {
            throw AetherNativeError.inference("prompt vazio")
        }

        try decode(tokens: &promptTokens, context: context)
        let generationStart = ProcessInfo.processInfo.systemUptime
        var output = ""
        var pendingUTF8 = Data()
        var outputTokenCount = 0
        var firstTokenAt: TimeInterval?

        for _ in 0..<maxOutput {
            try checkRuntimeLimits()
            let token = llama_sampler_sample(sampler, context, -1)
            if llama_vocab_is_eog(vocabulary, token) { break }
            outputTokenCount += 1
            llama_sampler_accept(sampler, token)

            pendingUTF8.append(piece(for: token, vocabulary: vocabulary))
            if let text = String(data: pendingUTF8, encoding: .utf8) {
                if firstTokenAt == nil { firstTokenAt = ProcessInfo.processInfo.systemUptime }
                pendingUTF8.removeAll(keepingCapacity: true)
                output += text
                onToken(text)
            }

            var generated = [token]
            try decode(tokens: &generated, context: context)
        }

        if !pendingUTF8.isEmpty {
            if firstTokenAt == nil { firstTokenAt = ProcessInfo.processInfo.systemUptime }
            let replacement = String(decoding: pendingUTF8, as: UTF8.self)
            output += replacement
            onToken(replacement)
        }
        let finishedAt = ProcessInfo.processInfo.systemUptime
        let endSnapshot = AetherPerformanceMonitor.snapshot()
        let generationSeconds = max(0.001, finishedAt - generationStart)
        let (inferenceThreads, batchThreads) = threadConfiguration()
        return AetherEngineResult(
            text: output.trimmingCharacters(in: .whitespacesAndNewlines),
            promptTokens: promptTokens.count,
            outputTokens: outputTokenCount,
            loadMilliseconds: loadMilliseconds,
            timeToFirstTokenMilliseconds: ((firstTokenAt ?? finishedAt) - totalStart) * 1_000,
            generationMilliseconds: generationSeconds * 1_000,
            totalMilliseconds: (finishedAt - totalStart) * 1_000,
            tokensPerSecond: Double(outputTokenCount) / generationSeconds,
            inferenceThreads: inferenceThreads,
            batchThreads: batchThreads,
            residentBytesBefore: startSnapshot.residentBytes,
            residentBytesAfter: endSnapshot.residentBytes,
            observedPeakBytes: endSnapshot.observedPeakBytes,
            processCPUSeconds: max(0, endSnapshot.cpuSeconds - startSnapshot.cpuSeconds),
            thermalStateStart: thermalStart,
            thermalStateEnd: Self.thermalStateName
        )
    }

    private func prepareForGeneration(modelURL: URL) throws {
        let thermal = ProcessInfo.processInfo.thermalState
        if thermal == .serious || thermal == .critical {
            if thermal == .critical { unload() }
            throw AetherNativeError.thermalBlocked
        }

        if model != nil, context != nil, loadedModelPath == modelURL.path {
            configureThreads()
            return
        }
        unload()
        if !backendInitialized {
            llama_backend_init()
            backendInitialized = true
        }

        var modelParameters = llama_model_default_params()
        modelParameters.n_gpu_layers = -1
        modelParameters.check_tensors = false
        guard let loadedModel = llama_model_load_from_file(modelURL.path, modelParameters) else {
            throw AetherNativeError.modelLoad("o arquivo GGUF não pôde ser lido")
        }
        model = loadedModel

        var contextParameters = llama_context_default_params()
        contextParameters.n_ctx = 4_096
        contextParameters.n_batch = 512
        contextParameters.n_ubatch = 128
        contextParameters.n_seq_max = 1
        contextParameters.offload_kqv = true
        contextParameters.n_threads = 4
        contextParameters.n_threads_batch = 6
        guard let loadedContext = llama_init_from_model(loadedModel, contextParameters) else {
            llama_model_free(loadedModel)
            model = nil
            throw AetherNativeError.modelLoad("não foi possível reservar memória para o contexto")
        }
        context = loadedContext
        loadedModelPath = modelURL.path
        sampler = makeSampler()
        configureThreads()
    }

    private func makeSampler() -> UnsafeMutablePointer<llama_sampler>? {
        var parameters = llama_sampler_chain_default_params()
        parameters.no_perf = true
        guard let chain = llama_sampler_chain_init(parameters) else { return nil }
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(40))
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.92, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_min_p(0.05, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_temp(0.65))
        llama_sampler_chain_add(chain, llama_sampler_init_penalties(128, 1.08, 0, 0))
        llama_sampler_chain_add(chain, llama_sampler_init_dist(UInt32.random(in: 1...UInt32.max)))
        return chain
    }

    private func configureThreads() {
        guard let context else { return }
        let (inferenceThreads, batchThreads) = threadConfiguration()
        llama_set_n_threads(context, Int32(inferenceThreads), Int32(batchThreads))
    }

    private func threadConfiguration() -> (Int, Int) {
        let constrained = ProcessInfo.processInfo.isLowPowerModeEnabled
            || ProcessInfo.processInfo.thermalState == .fair
        return constrained ? (2, 4) : (4, 6)
    }

    private static var thermalStateName: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    private func generationTokenBudget() -> Int {
        if ProcessInfo.processInfo.isLowPowerModeEnabled || ProcessInfo.processInfo.thermalState == .fair {
            return 320
        }
        return 512
    }

    private func checkRuntimeLimits() throws {
        stateLock.lock()
        let cancelled = cancellationRequested
        stateLock.unlock()
        if cancelled { throw AetherNativeError.cancelled }

        switch ProcessInfo.processInfo.thermalState {
        case .serious:
            throw AetherNativeError.thermalBlocked
        case .critical:
            unload()
            throw AetherNativeError.thermalBlocked
        default:
            break
        }
    }

    private func tokenize(_ text: String, vocabulary: OpaquePointer) throws -> [llama_token] {
        let byteCount = Int32(text.lengthOfBytes(using: .utf8))
        let required = text.withCString {
            llama_tokenize(vocabulary, $0, byteCount, nil, 0, true, true)
        }
        let capacity = required < 0 ? Int(-required) : max(Int(required), 1)
        var tokens = [llama_token](repeating: 0, count: capacity)
        let count = text.withCString { pointer in
            tokens.withUnsafeMutableBufferPointer { buffer in
                llama_tokenize(
                    vocabulary,
                    pointer,
                    byteCount,
                    buffer.baseAddress,
                    Int32(buffer.count),
                    true,
                    true
                )
            }
        }
        guard count >= 0 else { throw AetherNativeError.inference("falha ao tokenizar o contexto") }
        return Array(tokens.prefix(Int(count)))
    }

    private func tokenizePreservingSystemPrompt(
        _ prompt: String,
        vocabulary: OpaquePointer
    ) throws -> [llama_token] {
        let maximumPromptTokens = 4_096 - generationTokenBudget() - 8
        var tokens = try tokenize(prompt, vocabulary: vocabulary)
        guard tokens.count > maximumPromptTokens else { return tokens }

        let systemEnd = "<|im_end|>\n"
        guard let boundary = prompt.range(of: systemEnd) else {
            return Array(tokens.suffix(maximumPromptTokens))
        }

        let systemText = String(prompt[..<boundary.upperBound])
        let conversationText = String(prompt[boundary.upperBound...])
        var systemTokens = try tokenize(systemText, vocabulary: vocabulary)
        if systemTokens.count >= maximumPromptTokens {
            systemTokens = Array(systemTokens.prefix(maximumPromptTokens / 2))
        }
        let conversationBudget = max(1, maximumPromptTokens - systemTokens.count)
        let conversationTokens = try tokenize(conversationText, vocabulary: vocabulary)
        tokens = systemTokens + conversationTokens.suffix(conversationBudget)
        return tokens
    }

    private func decode(tokens: inout [llama_token], context: OpaquePointer) throws {
        try tokens.withUnsafeMutableBufferPointer { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                try checkRuntimeLimits()
                let amount = min(256, buffer.count - offset)
                let batch = llama_batch_get_one(base.advanced(by: offset), Int32(amount))
                let result = llama_decode(context, batch)
                guard result == 0 else {
                    throw AetherNativeError.inference("llama_decode retornou \(result)")
                }
                offset += amount
            }
        }
    }

    private func piece(for token: llama_token, vocabulary: OpaquePointer) -> Data {
        var buffer = [CChar](repeating: 0, count: 256)
        var count = buffer.withUnsafeMutableBufferPointer {
            llama_token_to_piece(vocabulary, token, $0.baseAddress, Int32($0.count), 0, false)
        }
        if count < 0 {
            buffer = [CChar](repeating: 0, count: Int(-count))
            count = buffer.withUnsafeMutableBufferPointer {
                llama_token_to_piece(vocabulary, token, $0.baseAddress, Int32($0.count), 0, false)
            }
        }
        guard count > 0 else { return Data() }
        return Data(buffer.prefix(Int(count)).map { UInt8(bitPattern: $0) })
    }
}
