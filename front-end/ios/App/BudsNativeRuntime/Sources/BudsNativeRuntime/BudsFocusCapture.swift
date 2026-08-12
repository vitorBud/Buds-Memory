import CryptoKit
import Foundation

struct BudsFocusCandidate: Sendable {
    let itemType: String
    let content: String
    let category: String
    let priority: String
    let dueDate: String?
    let confidence: Double
    let autoApply: Bool
    let dedupKey: String
    let placeContext: String
    let triggerOnArrival: Bool
}

/// Espelho leve do detector Flask. Não executa o 4B e, portanto, pode rodar em
/// toda mensagem sem criar aquecimento perceptível no iPhone.
enum BudsFocusCapture {
    static func detect(_ text: String, now: Date = Date()) -> [BudsFocusCandidate] {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard message.count >= 6 else { return [] }
        let normalizedMessage = normalize(message)
        let looksLikeExample = containsAny(normalizedMessage, ["por exemplo", "frases como", "se eu disser", "exemplo:"])
        var seen = Set<String>()
        var candidates: [BudsFocusCandidate] = []

        for phrase in split(message).prefix(12) {
            let normalized = normalize(phrase)
            if containsAny(normalized, ["nao preciso", "nao tenho que", "ja nao preciso"]) { continue }

            let itemType: String
            let confidence: Double
            let explicitFocusCommand = isExplicitFocusCommand(normalized)
            if explicitFocusCommand {
                itemType = normalized.contains("lembrete") ? "REMINDER" : "TASK"
                confidence = 0.995
            } else if containsAny(normalized, ["me lembra", "me lembre", "lembrete", "nao posso esquecer"]) {
                itemType = "REMINDER"; confidence = 0.99
            } else if containsAny(normalized, ["tenho que", "preciso", "devo", "vou precisar"]) {
                itemType = "TASK"; confidence = 0.96
            } else if startsLikeScheduledTask(normalized) {
                itemType = "TASK"; confidence = 0.91
            } else if containsAny(normalized, ["tive uma ideia", "minha ideia", "ideia:"]) {
                itemType = "IDEA"; confidence = 0.88
            } else if containsAny(normalized, ["decidi que", "minha decisao", "tomei a decisao"]) {
                itemType = "DECISION"; confidence = 0.94
            } else if containsAny(normalized, ["guarde que", "lembre que", "memorize que"]) {
                itemType = "MEMORY"; confidence = 0.94
            } else {
                continue
            }

            let location = placeContext(normalized)
            let commandContent = explicitFocusCommand ? stripFocusCommand(phrase) : phrase
            let content = cleanContent(commandContent, itemType: itemType, stripArrival: location.trigger)
            guard content.count >= 3 else { continue }
            let dueDate = ["TASK", "REMINDER"].contains(itemType) ? parseDueDate(phrase, now: now) : nil
            let adjustedConfidence = ((phrase.contains("?") && !explicitFocusCommand) || looksLikeExample) ? min(confidence, 0.74) : confidence
            let autoApply = ["TASK", "REMINDER"].contains(itemType)
                && adjustedConfidence >= 0.9 && (explicitFocusCommand || !phrase.contains("?")) && !looksLikeExample
            let key = makeKey(itemType: itemType, content: content, dueDate: dueDate, placeContext: location.context)
            guard seen.insert(key).inserted else { continue }
            candidates.append(BudsFocusCandidate(
                itemType: itemType,
                content: content,
                category: category(normalized),
                priority: priority(normalized),
                dueDate: dueDate,
                confidence: adjustedConfidence,
                autoApply: autoApply,
                dedupKey: key,
                placeContext: location.context,
                triggerOnArrival: location.trigger
            ))
        }
        return candidates
    }

    private static func split(_ text: String) -> [String] {
        let pattern = #"(?<=[.!?;])\s+|\s+(?:e também|alem disso|além disso)\s+"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [text] }
        let range = NSRange(text.startIndex..., in: text)
        var last = text.startIndex
        var parts: [String] = []
        for match in regex.matches(in: text, range: range) {
            guard let swiftRange = Range(match.range, in: text) else { continue }
            let part = text[last..<swiftRange.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
            if !part.isEmpty { parts.append(part) }
            last = swiftRange.upperBound
        }
        let tail = text[last...].trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { parts.append(tail) }
        return parts
    }

    private static func normalize(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "pt_BR"))
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func containsAny(_ text: String, _ terms: [String]) -> Bool {
        terms.contains(where: text.contains)
    }

    private static func isExplicitFocusCommand(_ text: String) -> Bool {
        let actions = ["adicionar", "adiciona", "adicione", "colocar", "coloca", "coloque", "criar", "cria", "crie", "incluir", "inclui", "inclua", "salvar", "salva", "salve", "jogar", "joga", "jogue", "anotar", "anota", "anote"]
        let destinations = ["no focus", "ao focus", "pro focus", "para o focus", "no buds focus", "para o buds focus"]
        return containsAny(text, actions) && containsAny(text, destinations)
    }

    private static func stripFocusCommand(_ text: String) -> String {
        var value = text.trimmingCharacters(in: CharacterSet(charactersIn: " \t\n\"“”"))
        let patterns = [
            #"^(?:por favor[,]?\s*)?(?:você\s+)?(?:pode|consegue|poderia)?\s*"#,
            #"^(?:adicionar|adiciona|adicione|colocar|coloca|coloque|criar|cria|crie|incluir|inclui|inclua|salvar|salva|salve|jogar|joga|jogue|anotar|anota|anote)\s+"#,
            #"^(?:no|ao|pro|para o)\s+(?:buds\s+)?focus\s*[:,\-]?\s*"#,
            #"\s+(?:no|ao|pro|para o)\s+(?:buds\s+)?focus\b"#,
            #"\s+como\s+(?:tarefa|lembrete)\b"#,
            #"[?]+$"#,
        ]
        for pattern in patterns {
            value = value.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
        }
        return value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.;:-"))
    }

    private static func startsLikeScheduledTask(_ text: String) -> Bool {
        guard containsAny(text, ["hoje", "amanha", "depois de amanha"]) else { return false }
        return containsAny(text, ["vou fazer", "vou terminar", "quero fazer", "quero terminar", "vou resolver", "vou estudar"])
    }

    private static func cleanContent(_ phrase: String, itemType: String, stripArrival: Bool = false) -> String {
        var value = phrase.trimmingCharacters(in: CharacterSet(charactersIn: " \t\n\"“”"))
        if stripArrival {
            value = value.replacingOccurrences(
                of: #"\b(?:quando|assim que)\s+(?:eu\s+)?(?:chegar|entrar|voltar)\s+(?:em|no|na|ao|a|pra|para)?\s*(?:casa|trabalho|empresa|escritório|academia|treino|faculdade|escola|curso|biblioteca)\b[,]?"#,
                with: "",
                options: [.regularExpression, .caseInsensitive]
            ).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let prefixes: [String: [String]] = [
            "REMINDER": [#"^(?:por favor,?\s*)?me lembr(?:a|e)\s+"#, #"^(?:eu\s+)?não posso esquecer(?:\s+de)?\s+"#, #"^lembrete\s*:?\s*"#],
            "TASK": [#"^(?:hoje|amanhã|depois de amanhã)[,\s]+"#, #"^(?:eu\s+)?(?:tenho que|preciso|devo|vou precisar)\s+"#, #"^(?:quero|vou)\s+(?:terminar|fazer|resolver|entregar|revisar|estudar)\s+"#],
            "IDEA": [#"^(?:eu\s+)?tive uma ideia(?:\s+de)?\s*:?\s*"#, #"^(?:minha\s+)?ideia(?:\s+é)?\s*:?\s*"#],
            "DECISION": [#"^(?:eu\s+)?decidi(?:\s+que)?\s+"#, #"^(?:minha\s+)?decisão(?:\s+é)?\s*:?\s*"#],
            "MEMORY": [#"^(?:guarde|lembre)(?:-se)?\s+que\s+"#, #"^memorize(?:\s+que)?\s+"#],
        ]
        for pattern in prefixes[itemType] ?? [] {
            value = replaceFirst(pattern, in: value, with: "")
        }
        let removals = [
            #"\b(?:hoje|amanhã|depois de amanhã)\b"#,
            #"\b(?:segunda(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|domingo)\b"#,
            #"\b(?:às?|por volta das?)\s*\d{1,2}(?:(?::|h)\d{0,2})?\s*(?:h|horas?)?\b"#,
            #"\b(?:dia\s+)?\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b"#,
        ]
        for pattern in removals {
            value = value.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
        }
        value = value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.;:-"))
        value = replaceFirst(#"^(?:de|para|que)\s+"#, in: value, with: "")
        guard let first = value.first else { return "" }
        return String((String(first).uppercased() + value.dropFirst()).prefix(500))
    }

    private static func replaceFirst(_ pattern: String, in text: String, with replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else { return text }
        return text.replacingCharacters(in: range, with: replacement)
    }

    private static func priority(_ text: String) -> String {
        if containsAny(text, ["urgente", "prioridade maxima", "importantissimo", "nao posso esquecer", "ainda hoje", "ate hoje"]) { return "high" }
        if containsAny(text, ["sem pressa", "quando der", "algum dia", "baixa prioridade"]) { return "low" }
        return "medium"
    }

    private static func category(_ text: String) -> String {
        if containsAny(text, ["trabalho", "cliente", "relatorio", "reuniao", "empresa", "email", "e-mail"]) { return "work" }
        if containsAny(text, ["estudar", "estudo", "prova", "curso", "faculdade", "aula", "livro"]) { return "study" }
        if containsAny(text, ["projeto", "codigo", "programar", "frontend", "backend", "app", "deploy", "github"]) { return "project" }
        if containsAny(text, ["casa", "mercado", "medico", "familia", "academia", "pessoal"]) { return "personal" }
        return "other"
    }

    private static func placeContext(_ text: String) -> (context: String, trigger: Bool) {
        let trigger = text.range(of: #"\b(?:quando|assim que)\s+(?:eu\s+)?(?:chegar|entrar|voltar)\b"#, options: .regularExpression) != nil
        if containsAny(text, ["casa", "em casa", "pra casa", "para casa"]) { return ("home", trigger) }
        if containsAny(text, ["trabalho", "empresa", "escritorio"]) { return ("work", trigger) }
        if containsAny(text, ["academia", "treino"]) { return ("gym", trigger) }
        if containsAny(text, ["faculdade", "escola", "curso", "biblioteca"]) { return ("study", trigger) }
        return ("anywhere", false)
    }

    private static func parseDueDate(_ text: String, now: Date) -> String? {
        let normalized = normalize(text)
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        var hasDate = false
        if normalized.contains("depois de amanha") {
            let date = calendar.date(byAdding: .day, value: 2, to: now) ?? now
            components = calendar.dateComponents([.year, .month, .day], from: date); hasDate = true
        } else if normalized.contains("amanha") {
            let date = calendar.date(byAdding: .day, value: 1, to: now) ?? now
            components = calendar.dateComponents([.year, .month, .day], from: date); hasDate = true
        } else if normalized.contains("hoje") {
            hasDate = true
        } else if let groups = matchGroups(#"\b(?:dia\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b"#, text: normalized) {
            components.day = Int(groups[0]); components.month = Int(groups[1])
            if groups.count > 2, let year = Int(groups[2]), !groups[2].isEmpty { components.year = year < 100 ? year + 2000 : year }
            hasDate = true
        } else {
            let weekdays = [
                "domingo": 1, "segunda": 2, "segunda-feira": 2,
                "terca": 3, "terca-feira": 3, "quarta": 4, "quarta-feira": 4,
                "quinta": 5, "quinta-feira": 5, "sexta": 6, "sexta-feira": 6,
                "sabado": 7,
            ]
            let currentWeekday = calendar.component(.weekday, from: now)
            for (label, targetWeekday) in weekdays where normalized.range(of: #"\b\#(label)\b"#, options: .regularExpression) != nil {
                let rawDays = (targetWeekday - currentWeekday + 7) % 7
                let date = calendar.date(byAdding: .day, value: rawDays == 0 ? 7 : rawDays, to: now) ?? now
                components = calendar.dateComponents([.year, .month, .day], from: date)
                hasDate = true
                break
            }
        }

        let time = matchGroups(#"\b(?:as|a|por volta das?)\s*(\d{1,2})(?:(?::|h)(\d{2}))?\s*(?:h|horas?)?\b"#, text: normalized)
        guard hasDate || time != nil else { return nil }
        components.hour = time.flatMap { Int($0[0]) } ?? 9
        components.minute = time.flatMap { $0.count > 1 ? Int($0[1]) : nil } ?? 0
        components.second = 0
        guard var date = calendar.date(from: components) else { return nil }
        if !hasDate && date <= now { date = calendar.date(byAdding: .day, value: 1, to: date) ?? date }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.string(from: date)
    }

    private static func matchGroups(_ pattern: String, text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            guard let range = Range(match.range(at: index), in: text) else { return "" }
            return String(text[range])
        }
    }

    private static func makeKey(itemType: String, content: String, dueDate: String?, placeContext: String) -> String {
        let stopwords = Set(["o", "a", "os", "as", "um", "uma", "de", "do", "da", "para", "que"])
        let semantic = normalize(content)
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty && !stopwords.contains($0) }
            .joined(separator: " ")
        let payload = "\(itemType):\(semantic):\((dueDate ?? "").prefix(10)):\(placeContext)"
        return SHA256.hash(data: Data(payload.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
