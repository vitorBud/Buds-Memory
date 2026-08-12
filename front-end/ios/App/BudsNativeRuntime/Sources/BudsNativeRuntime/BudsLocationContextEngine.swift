import Foundation

/// Lugar semântico sem coordenadas, seguro para prompt e diagnóstico.
public struct BudsSemanticPlace: Sendable {
    public let id: Int64?
    public let name: String
    public let type: String
}

public struct BudsLocationRoutine: Sendable {
    public let kind: String
    public let origin: BudsSemanticPlace
    public let destination: BudsSemanticPlace
    public let sampleCount: Int
    public let totalTransitions: Int
    public let confidence: Double
    public let typicalArrivalTime: String?
}

/// Snapshot efêmero derivado somente de registros locais já existentes.
public struct BudsSemanticLocationContext: Sendable {
    public let version: Int
    public let currentPlace: BudsSemanticPlace?
    public let previousPlace: BudsSemanticPlace?
    public let state: String
    public let movement: String
    public let tripActive: Bool
    public let tripOrigin: BudsSemanticPlace?
    public let tripDestination: BudsSemanticPlace?
    public let destinationConfidence: Double?
    public let routine: BudsLocationRoutine?
    public let tripDurationSeconds: Int
    public let recentEvent: String?
    public let recentEventAt: String?
    public let recentEventAgeSeconds: Int?
    public let relevance: String
    /// Coordenadas ficam somente no processo local e não são serializadas pela
    /// ponte. O prompt as usa apenas quando o usuário pergunta onde está.
    public let exactLatitude: Double?
    public let exactLongitude: Double?
    public let exactAccuracyMeters: Double?
}

/// SENSORES -> CÓDIGO NATIVO -> CONTEXT ENGINE -> QWEN.
///
/// O engine não inicia sensores, não escreve no banco e não chama o modelo.
/// Toda decisão é determinística e pode ser testada com registros sintéticos.
public enum BudsLocationContextEngine {
    private static let transitionTTL = 10 * 60
    private static let recentEventTTL = 45 * 60
    private static let highTTL = 5 * 60
    private static let mediumTTL = 15 * 60

    private struct Candidate {
        let type: String
        let rawType: String
        let place: BudsSemanticPlace?
        let context: String
        let occurredAt: String
        let ageSeconds: Int
    }

    public static func derive(
        state: BudsLocationStateRecord,
        events: [BudsLocationEventRecord],
        activeTrip: BudsLocationRouteRecord?,
        recentTrip: BudsLocationRouteRecord?,
        now: Date = Date()
    ) -> BudsSemanticLocationContext {
        let tripActive = activeTrip?.status == "active"
        let currentPlace = semanticPlace(state)
        let orderedEvents = events.sorted { $0.createdAt > $1.createdAt }
        let origin = tripOrigin(activeTrip: activeTrip, events: orderedEvents, now: now)
        let recent = recentCandidate(
            events: orderedEvents,
            activeTrip: activeTrip,
            recentTrip: recentTrip,
            now: now
        )

        var contextState = stableState(state: state, tripActive: tripActive)
        let latestLocationEvent = orderedEvents.first { ["enter", "exit"].contains($0.eventType) }
        let latestLocationAge = latestLocationEvent.flatMap { age($0.createdAt, now: now) }
        if let event = latestLocationEvent,
           let eventAge = latestLocationAge,
           eventAge <= transitionTTL {
            if event.eventType == "enter", currentPlace != nil {
                contextState = transitionState(prefix: "ARRIVING", context: event.context) ?? "AT_KNOWN_PLACE"
            } else if event.eventType == "exit", currentPlace == nil {
                contextState = transitionState(prefix: "LEAVING", context: event.context)
                    ?? (tripActive ? "COMMUTING" : "UNKNOWN")
            }
        }

        let relevance: String
        if let eventAge = recent?.ageSeconds, eventAge <= highTTL {
            relevance = "HIGH"
        } else if let eventAge = recent?.ageSeconds, eventAge <= mediumTTL {
            relevance = "MEDIUM"
        } else if recent != nil {
            relevance = "LOW"
        } else if tripActive {
            let tripAge = activeTrip.flatMap { age($0.startedAt, now: now) }
            relevance = (tripAge ?? Int.max) <= 60 * 60 ? "MEDIUM" : "LOW"
        } else if currentPlace != nil {
            relevance = "LOW"
        } else {
            relevance = "NONE"
        }

        // Estar dentro de uma geofence não comprova imobilidade. Fora de um
        // trajeto ativo, não inferimos movimento físico sem velocidade recente.
        let movement = (tripActive || state.context == "commuting") ? "MOVING" : "UNKNOWN"
        let previousPlace = origin ?? latestLocationEvent.flatMap {
            guard $0.eventType == "exit", (latestLocationAge ?? Int.max) <= recentEventTTL else { return nil }
            return semanticPlace($0)
        }
        let routine = learnTransitionPattern(events: orderedEvents, origin: origin ?? previousPlace)
        let route = activeTrip ?? recentTrip

        return BudsSemanticLocationContext(
            version: 1,
            currentPlace: currentPlace,
            previousPlace: previousPlace,
            state: contextState,
            movement: movement,
            tripActive: tripActive,
            tripOrigin: origin,
            tripDestination: routine?.destination,
            destinationConfidence: routine?.confidence,
            routine: routine,
            tripDurationSeconds: route?.durationSeconds ?? 0,
            recentEvent: recent?.type,
            recentEventAt: recent?.occurredAt,
            recentEventAgeSeconds: recent?.ageSeconds,
            relevance: relevance,
            exactLatitude: state.latitude,
            exactLongitude: state.longitude,
            exactAccuracyMeters: state.accuracyMeters
        )
    }

    public static func promptForChat(_ context: BudsSemanticLocationContext, userText: String) -> String? {
        guard shouldAttachToChat(userText, context: context) else { return nil }
        var lines = [
            "CONTEXTO LOCAL EFÊMERO (gerado por código; não é memória):",
            "- estado: \(context.state)",
            "- movimento: \(context.movement)",
            "- trajeto ativo: \(context.tripActive ? "sim" : "não")",
            "- relevância: \(context.relevance)",
        ]
        if let place = context.currentPlace { lines.append("- lugar atual: \(place.name)") }
        if let place = context.previousPlace { lines.append("- lugar anterior: \(place.name)") }
        if let place = context.tripOrigin { lines.append("- origem do trajeto: \(place.name)") }
        if let destination = context.tripDestination {
            let confidence = Int((context.destinationConfidence ?? 0) * 100)
            lines.append("- destino provável: \(destination.name) (confiança \(confidence)%; é previsão, não fato)")
        } else if context.tripActive {
            lines.append("- destino do trajeto: desconhecido")
        }
        if let event = context.recentEvent, let eventAge = context.recentEventAgeSeconds {
            lines.append("- evento recente: \(event) há \(eventAge) segundos")
        }
        if requiresExactLocationRefresh(userText),
           let latitude = context.exactLatitude,
           let longitude = context.exactLongitude {
            lines.append(String(format: "- latitude local: %.6f", latitude))
            lines.append(String(format: "- longitude local: %.6f", longitude))
            if let accuracy = context.exactAccuracyMeters {
                lines.append("- precisão estimada: \(Int(accuracy.rounded())) metros")
            }
        }
        lines.append(
            "Use isso somente se encaixar naturalmente na mensagem atual. "
            + "Ignore em perguntas técnicas ou sem relação. O contexto é suplementar. "
            + "Não mencione rastreamento ou sensores; só repita coordenadas se o usuário pediu a localização. "
            + "Nunca apresente destino provável como confirmado; trate UNKNOWN como incerto."
        )
        return lines.joined(separator: "\n")
    }

    public static func promptForFocus(_ context: BudsSemanticLocationContext) -> String {
        guard context.state != "UNKNOWN" else { return "" }
        let place = context.currentPlace?.name ?? context.previousPlace?.name ?? "não confirmado"
        return "Contexto local por código: estado \(context.state), lugar \(place), "
            + "trajeto ativo \(context.tripActive ? "sim" : "não"). "
            + "Use somente para priorizar; nunca mencione coordenadas."
    }

    public static func shouldAttachToChat(
        _ userText: String,
        context: BudsSemanticLocationContext
    ) -> Bool {
        let text = normalize(userText)
        let explicitLocationQueries = [
            "onde estou", "onde exatamente estou", "qual e minha localizacao", "minha localizacao",
            "localizacao atual", "em que lugar estou", "em que lugar eu estou",
        ]
        if explicitLocationQueries.contains(where: text.contains) { return true }
        let destinationQueries = ["para onde vou", "para onde eu vou", "para onde estou indo", "onde estou indo", "qual o destino", "destino provavel"]
        if context.tripDestination != nil, destinationQueries.contains(where: text.contains) { return true }
        guard context.relevance != "NONE" else { return false }
        let locationTerms = [
            "casa", "trabalho", "academia", "faculdade", "estudo", "localizacao",
            "onde estou", "chegar", "cheguei", "saindo", "sair", "trajeto", "caminho",
            "percurso", "rota", "deslocamento", "focus", "tarefa", "lembrete",
        ]
        if locationTerms.contains(where: text.contains) { return true }
        if ["HIGH", "MEDIUM"].contains(context.relevance), context.state == "COMMUTING" {
            let movementPhrases = ["to indo", "estou indo", "indo resolver", "saindo agora", "ja to na rua"]
            if movementPhrases.contains(where: text.hasPrefix) { return true }
        }
        guard context.relevance == "HIGH", text.count <= 56 else { return false }
        let clean = text.trimmingCharacters(in: CharacterSet(charactersIn: "!,.? "))
        let casual = [
            "eai", "e ai", "oi", "ola", "bom dia", "boa tarde", "boa noite", "fala",
            "tudo bem", "e agora", "cheguei", "partiu", "finalmente",
            "eai chat", "e ai chat", "oi chat", "ola chat", "fala chat",
            "eai buds", "e ai buds", "oi buds", "ola buds", "fala buds",
        ]
        return casual.contains(clean)
    }

    public static func requiresExactLocationRefresh(_ userText: String) -> Bool {
        let text = normalize(userText)
        return [
            "onde estou", "onde exatamente estou", "localizacao exata", "minha localizacao",
            "localizacao atual", "coordenada", "latitude", "longitude", "em que lugar estou",
        ].contains(where: text.contains)
    }

    private static func learnTransitionPattern(
        events: [BudsLocationEventRecord],
        origin: BudsSemanticPlace?
    ) -> BudsLocationRoutine? {
        guard let origin else { return nil }
        let chronological = events.sorted { $0.createdAt < $1.createdAt }
        var destinations: [(BudsSemanticPlace, Date)] = []
        for (index, event) in chronological.enumerated()
        where event.eventType == "exit" && event.context == origin.type {
            guard let exitedAt = date(event.createdAt) else { continue }
            for candidate in chronological.dropFirst(index + 1) {
                guard let arrivedAt = date(candidate.createdAt) else { continue }
                if arrivedAt.timeIntervalSince(exitedAt) > 6 * 60 * 60 { break }
                if candidate.eventType == "enter", candidate.context != origin.type,
                   let destination = semanticPlace(candidate) {
                    destinations.append((destination, arrivedAt))
                    break
                }
            }
        }
        guard !destinations.isEmpty else { return nil }
        var counts: [String: Int] = [:]
        var places: [String: BudsSemanticPlace] = [:]
        var arrivalMinutes: [String: [Int]] = [:]
        let calendar = Calendar.current
        for (destination, arrivedAt) in destinations {
            let key = destination.type
            counts[key, default: 0] += 1
            places[key] = destination
            arrivalMinutes[key, default: []].append(
                calendar.component(.hour, from: arrivedAt) * 60 + calendar.component(.minute, from: arrivedAt)
            )
        }
        guard let winner = counts.max(by: { $0.value < $1.value })?.key,
              let samples = counts[winner], let destination = places[winner] else { return nil }
        let total = counts.values.reduce(0, +)
        let confidence = Double(samples) / Double(max(1, total))
        guard samples >= 3, confidence >= 0.60 else { return nil }
        let minutes = (arrivalMinutes[winner] ?? []).sorted()
        let typical = minutes.isEmpty ? nil : String(format: "%02d:%02d", minutes[minutes.count / 2] / 60, minutes[minutes.count / 2] % 60)
        return BudsLocationRoutine(
            kind: "PLACE_TRANSITION", origin: origin, destination: destination,
            sampleCount: samples, totalTransitions: total, confidence: confidence,
            typicalArrivalTime: typical
        )
    }

    private static func stableState(state: BudsLocationStateRecord, tripActive: Bool) -> String {
        if tripActive || state.context == "commuting" { return "COMMUTING" }
        let isConfirmedPlace = state.placeId != nil || state.status == "inside"
        let isExplicitManualContext = state.status == "manual"
            && ["home", "work", "gym", "study", "other"].contains(state.context)
        if isConfirmedPlace || isExplicitManualContext {
            if state.context == "home" { return "AT_HOME" }
            if state.context == "work" { return "AT_WORK" }
            return "AT_KNOWN_PLACE"
        }
        return "UNKNOWN"
    }

    private static func transitionState(prefix: String, context: String) -> String? {
        if context == "home" { return "\(prefix)_HOME" }
        if context == "work" { return "\(prefix)_WORK" }
        return nil
    }

    private static func recentCandidate(
        events: [BudsLocationEventRecord],
        activeTrip: BudsLocationRouteRecord?,
        recentTrip: BudsLocationRouteRecord?,
        now: Date
    ) -> Candidate? {
        var candidates = events.compactMap { event -> Candidate? in
            guard ["enter", "exit", "context_changed"].contains(event.eventType),
                  let eventAge = age(event.createdAt, now: now) else { return nil }
            return Candidate(
                type: semanticEvent(event.eventType, context: event.context),
                rawType: event.eventType,
                place: semanticPlace(event),
                context: event.context,
                occurredAt: event.createdAt,
                ageSeconds: eventAge
            )
        }
        if let activeTrip, let eventAge = age(activeTrip.startedAt, now: now) {
            candidates.append(Candidate(
                type: "TRIP_STARTED", rawType: "trip_started", place: nil,
                context: "commuting", occurredAt: activeTrip.startedAt, ageSeconds: eventAge
            ))
        } else if let recentTrip, let endedAt = recentTrip.endedAt, let eventAge = age(endedAt, now: now) {
            candidates.append(Candidate(
                type: "TRIP_STOPPED", rawType: "trip_stopped", place: nil,
                context: recentTrip.status, occurredAt: endedAt, ageSeconds: eventAge
            ))
        }
        return candidates.filter { $0.ageSeconds <= recentEventTTL }.min { $0.ageSeconds < $1.ageSeconds }
    }

    private static func tripOrigin(
        activeTrip: BudsLocationRouteRecord?,
        events: [BudsLocationEventRecord],
        now: Date
    ) -> BudsSemanticPlace? {
        guard let activeTrip, let started = date(activeTrip.startedAt) else { return nil }
        return events
            .filter { $0.eventType == "exit" }
            .sorted { $0.createdAt > $1.createdAt }
            .first { event in
                guard let eventDate = date(event.createdAt) else { return false }
                return abs(eventDate.timeIntervalSince(started)) <= Double(transitionTTL)
            }
            .flatMap(semanticPlace)
    }

    private static func semanticEvent(_ type: String, context: String) -> String {
        let suffix: String
        switch context {
        case "home": suffix = "HOME"
        case "work": suffix = "WORK"
        case "gym": suffix = "GYM"
        case "study": suffix = "STUDY"
        default: suffix = "KNOWN_PLACE"
        }
        if type == "enter" { return "ARRIVED_\(suffix)" }
        if type == "exit" { return "LEFT_\(suffix)" }
        return "CONTEXT_CHANGED"
    }

    private static func semanticPlace(_ state: BudsLocationStateRecord) -> BudsSemanticPlace? {
        let isExplicitManualContext = state.status == "manual"
            && ["home", "work", "gym", "study", "other"].contains(state.context)
        guard state.placeId != nil || state.status == "inside" || isExplicitManualContext else { return nil }
        return BudsSemanticPlace(
            id: state.placeId,
            name: state.placeName ?? label(state.context),
            type: state.context
        )
    }

    private static func semanticPlace(_ event: BudsLocationEventRecord) -> BudsSemanticPlace? {
        guard event.placeId != nil || ["home", "work", "gym", "study", "other"].contains(event.context) else { return nil }
        return BudsSemanticPlace(
            id: event.placeId,
            name: event.placeName ?? label(event.context),
            type: event.context
        )
    }

    private static func label(_ context: String) -> String {
        switch context {
        case "home": return "Casa"
        case "work": return "Trabalho"
        case "gym": return "Academia"
        case "study": return "Estudo"
        default: return "Lugar conhecido"
        }
    }

    private static func age(_ value: String, now: Date) -> Int? {
        guard let parsed = date(value) else { return nil }
        return max(0, Int(now.timeIntervalSince(parsed)))
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = formatter.date(from: value) { return parsed }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private static func normalize(_ value: String) -> String {
        value.folding(options: .diacriticInsensitive, locale: .current)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
