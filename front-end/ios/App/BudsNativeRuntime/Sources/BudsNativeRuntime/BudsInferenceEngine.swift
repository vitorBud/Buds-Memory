import Foundation
import llama

final class BudsInferenceEngine: @unchecked Sendable {
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var sampler: UnsafeMutablePointer<llama_sampler>?
    private var loadedModelPath = ""
    private let stateLock = NSLock()
    private var cancellationRequested = false
    private var backendInitialized = false
    private var appliedThreadConfiguration: (inference: Int, batch: Int)?

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
        appliedThreadConfiguration = nil
    }

    func generate(
        prompt: String,
        modelURL: URL,
        onToken: @escaping @Sendable (String) -> Void
    ) throws -> BudsEngineResult {
        let totalStart = ProcessInfo.processInfo.systemUptime
        let startSnapshot = BudsPerformanceMonitor.snapshot()
        let thermalStart = Self.thermalStateName
        let loadStart = ProcessInfo.processInfo.systemUptime
        try prepareForGeneration(modelURL: modelURL)
        let loadMilliseconds = (ProcessInfo.processInfo.systemUptime - loadStart) * 1_000
        guard let model, let context, let sampler,
              let vocabulary = llama_model_get_vocab(model) else {
            throw BudsNativeError.modelLoad("runtime não inicializado")
        }

        stateLock.lock()
        cancellationRequested = false
        stateLock.unlock()
        llama_sampler_reset(sampler)
        llama_memory_clear(llama_get_memory(context), true)

        let maxOutput = generationTokenBudget()
        var promptTokens = try tokenizePreservingSystemPrompt(prompt, vocabulary: vocabulary)
        guard !promptTokens.isEmpty else {
            throw BudsNativeError.inference("prompt vazio")
        }

        try decode(tokens: &promptTokens, context: context)
        let generationStart = ProcessInfo.processInfo.systemUptime
        let responseFilter = BudsVisibleResponseFilter()
        var pendingUTF8 = Data()
        var outputTokenCount = 0
        var firstTokenAt: TimeInterval?

        for _ in 0..<maxOutput {
            try checkRuntimeLimits()

            // Ajusta somente quando o estado muda; reconfigurar o llama a cada token
            // gerava trabalho desnecessário justamente quando o aparelho aquecia.
            configureThreads()
            let thermal = ProcessInfo.processInfo.thermalState
            if thermal == .serious {
                Thread.sleep(forTimeInterval: 0.100)
            } else if thermal == .fair {
                Thread.sleep(forTimeInterval: 0.020)
            } else if ProcessInfo.processInfo.isLowPowerModeEnabled {
                Thread.sleep(forTimeInterval: 0.010)
            }

            let token = llama_sampler_sample(sampler, context, -1)
            if llama_vocab_is_eog(vocabulary, token) { break }
            outputTokenCount += 1
            llama_sampler_accept(sampler, token)

            pendingUTF8.append(piece(for: token, vocabulary: vocabulary))
            if let text = String(data: pendingUTF8, encoding: .utf8) {
                pendingUTF8.removeAll(keepingCapacity: true)
                let visible = responseFilter.consume(text)
                if !visible.isEmpty {
                    if firstTokenAt == nil { firstTokenAt = ProcessInfo.processInfo.systemUptime }
                    onToken(visible)
                }
            }

            var generated = [token]
            try decode(tokens: &generated, context: context)
        }

        if !pendingUTF8.isEmpty {
            let replacement = String(decoding: pendingUTF8, as: UTF8.self)
            let visible = responseFilter.consume(replacement)
            if !visible.isEmpty {
                if firstTokenAt == nil { firstTokenAt = ProcessInfo.processInfo.systemUptime }
                onToken(visible)
            }
        }
        let finalVisible = responseFilter.finish()
        if !finalVisible.isEmpty {
            if firstTokenAt == nil { firstTokenAt = ProcessInfo.processInfo.systemUptime }
            onToken(finalVisible)
        }
        let finishedAt = ProcessInfo.processInfo.systemUptime
        let endSnapshot = BudsPerformanceMonitor.snapshot()
        let generationSeconds = max(0.001, finishedAt - generationStart)
        let (inferenceThreads, batchThreads) = threadConfiguration()
        return BudsEngineResult(
            text: responseFilter.visibleText.trimmingCharacters(in: .whitespacesAndNewlines),
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
        if thermal == .critical {
            unload()
            throw BudsNativeError.thermalBlocked
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
            throw BudsNativeError.modelLoad("o arquivo GGUF não pôde ser lido")
        }
        model = loadedModel

        var contextParameters = llama_context_default_params()
        contextParameters.n_ctx = UInt32(BudsModelConfig.maxContextWindow)
        contextParameters.n_batch = 256
        contextParameters.n_ubatch = 64
        contextParameters.n_seq_max = 1
        contextParameters.offload_kqv = true
        contextParameters.n_threads = 3
        contextParameters.n_threads_batch = 4
        guard let loadedContext = llama_init_from_model(loadedModel, contextParameters) else {
            llama_model_free(loadedModel)
            model = nil
            throw BudsNativeError.modelLoad("não foi possível reservar memória para o contexto")
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
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(BudsModelConfig.topK))
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(BudsModelConfig.topP, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_min_p(BudsModelConfig.minP, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_temp(BudsModelConfig.temperature))
        llama_sampler_chain_add(chain, llama_sampler_init_penalties(128, BudsModelConfig.repeatPenalty, 0, BudsModelConfig.presencePenalty))
        llama_sampler_chain_add(chain, llama_sampler_init_dist(UInt32.random(in: 1...UInt32.max)))
        return chain
    }

    private func configureThreads() {
        guard let context else { return }
        let (inferenceThreads, batchThreads) = threadConfiguration()
        if appliedThreadConfiguration?.inference == inferenceThreads,
           appliedThreadConfiguration?.batch == batchThreads {
            return
        }
        llama_set_n_threads(context, Int32(inferenceThreads), Int32(batchThreads))
        appliedThreadConfiguration = (inferenceThreads, batchThreads)
    }

    private func threadConfiguration() -> (Int, Int) {
        let state = ProcessInfo.processInfo.thermalState
        if state == .serious || state == .critical {
            return (1, 1) // Modo emergência
        }
        let constrained = ProcessInfo.processInfo.isLowPowerModeEnabled || state == .fair
        return constrained ? (2, 2) : (2, 3)
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
            return Int(BudsModelConfig.maxTokensPerGeneration) / 2
        }
        return Int(BudsModelConfig.maxTokensPerGeneration)
    }

    private func checkRuntimeLimits() throws {
        stateLock.lock()
        let cancelled = cancellationRequested
        stateLock.unlock()
        if cancelled { throw BudsNativeError.cancelled }

        switch ProcessInfo.processInfo.thermalState {
        case .critical:
            throw BudsNativeError.thermalBlocked
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
        guard count >= 0 else { throw BudsNativeError.inference("falha ao tokenizar o contexto") }
        return Array(tokens.prefix(Int(count)))
    }

    private func tokenizePreservingSystemPrompt(
        _ prompt: String,
        vocabulary: OpaquePointer
    ) throws -> [llama_token] {
        let maximumPromptTokens = Int(BudsModelConfig.maxContextWindow) - generationTokenBudget() - 8
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

                let thermal = ProcessInfo.processInfo.thermalState

                // Lotes dinâmicos: Lê blocos grandes se estiver frio, blocos pequenos se estiver quente
                let maxBatchSize = (thermal == .nominal) ? 256 : (thermal == .fair || ProcessInfo.processInfo.isLowPowerModeEnabled) ? 128 : 64

                let amount = min(maxBatchSize, buffer.count - offset)
                let batch = llama_batch_get_one(base.advanced(by: offset), Int32(amount))
                let result = llama_decode(context, batch)
                guard result == 0 else {
                    throw BudsNativeError.inference("llama_decode retornou \(result)")
                }
                offset += amount

                // Resfriamento dinâmico otimizado (rápido quando frio, freia quando quente)
                if thermal == .critical {
                    Thread.sleep(forTimeInterval: 0.500)
                } else if thermal == .serious {
                    Thread.sleep(forTimeInterval: 0.150)
                } else if thermal == .fair {
                    Thread.sleep(forTimeInterval: 0.040) // 40ms é o "sweet spot" de velocidade vs calor
                } else if ProcessInfo.processInfo.isLowPowerModeEnabled {
                    Thread.sleep(forTimeInterval: 0.020)
                } else {
                    Thread.sleep(forTimeInterval: 0.005) // Quase sem pausa quando frio
                }
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
