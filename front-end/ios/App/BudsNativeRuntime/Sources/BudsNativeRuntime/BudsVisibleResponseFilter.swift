import Foundation

/// Remove blocos de raciocínio antes que qualquer token alcance a interface.
/// O parser incremental também segura tags divididas entre tokens, como `<thi` + `nk>`.
public final class BudsVisibleResponseFilter {
    private static let internalTags: Set<String> = [
        "think", "thinking", "analysis", "reasoning", "scratchpad", "internal",
    ]

    private var tagBuffer: String?
    private var hiddenDepth = 0
    public private(set) var visibleText = ""

    public init() {}

    @discardableResult
    public func consume(_ chunk: String) -> String {
        var emitted = ""

        for character in chunk {
            if var currentTag = tagBuffer {
                currentTag.append(character)
                tagBuffer = currentTag

                if character == ">" {
                    emitted += finishTag(currentTag)
                    tagBuffer = nil
                } else if currentTag.count > 160 {
                    if hiddenDepth == 0 { emitted += currentTag }
                    tagBuffer = nil
                }
                continue
            }

            if character == "<" {
                tagBuffer = "<"
            } else if hiddenDepth == 0 {
                emitted.append(character)
            }
        }

        visibleText += emitted
        return emitted
    }

    @discardableResult
    public func finish() -> String {
        guard let pendingTag = tagBuffer else { return "" }
        tagBuffer = nil

        guard hiddenDepth == 0, !Self.isInternalTagPrefix(pendingTag) else { return "" }
        visibleText += pendingTag
        return pendingTag
    }

    public static func sanitize(_ text: String) -> String {
        let filter = BudsVisibleResponseFilter()
        _ = filter.consume(text)
        _ = filter.finish()
        return filter.visibleText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func finishTag(_ rawTag: String) -> String {
        let body = rawTag
            .dropFirst()
            .dropLast()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let closing = body.hasPrefix("/")
        let normalized = body
            .drop(while: { $0 == "/" || $0.isWhitespace })
            .prefix(while: { !$0.isWhitespace && $0 != "/" })
            .lowercased()

        guard Self.internalTags.contains(normalized) else {
            return hiddenDepth == 0 ? rawTag : ""
        }

        if closing {
            hiddenDepth = max(0, hiddenDepth - 1)
        } else if !body.hasSuffix("/") {
            hiddenDepth += 1
        }
        return ""
    }

    private static func isInternalTagPrefix(_ rawTag: String) -> Bool {
        let compact = rawTag
            .lowercased()
            .filter { !$0.isWhitespace }
        return internalTags.contains { tag in
            "<\(tag)".hasPrefix(compact) || "</\(tag)".hasPrefix(compact)
        }
    }
}
