import Foundation
import PDFKit

public enum BudsPDFKnowledge {
    public static let maximumFileBytes = 24 * 1_024 * 1_024
    public static let maximumExtractedCharacters = 1_500_000

    public struct Extraction: Sendable {
        public let text: String
        public let pageCount: Int

        public init(text: String, pageCount: Int) {
            self.text = text
            self.pageCount = pageCount
        }
    }

    public static func extract(from data: Data) throws -> Extraction {
        guard !data.isEmpty else {
            throw BudsNativeError.documentImport("o arquivo está vazio")
        }
        guard data.count <= maximumFileBytes else {
            throw BudsNativeError.documentImport("o PDF deve ter no máximo 24 MB")
        }
        guard let document = PDFDocument(data: data) else {
            throw BudsNativeError.documentImport("o arquivo não é um PDF válido ou está protegido")
        }

        var pages: [String] = []
        pages.reserveCapacity(document.pageCount)
        var extractedCharacters = 0

        for index in 0..<document.pageCount {
            guard extractedCharacters < maximumExtractedCharacters,
                  let pageText = document.page(at: index)?.string else { continue }
            let clean = normalize(pageText)
            guard !clean.isEmpty else { continue }
            let remaining = maximumExtractedCharacters - extractedCharacters
            let clipped = String(clean.prefix(remaining))
            pages.append(clipped)
            extractedCharacters += clipped.count
        }

        let text = pages.joined(separator: "\n\n")
        guard text.count >= 20 else {
            throw BudsNativeError.documentImport(
                "não encontrei texto selecionável. PDFs formados apenas por imagens ainda precisam de OCR"
            )
        }
        return Extraction(text: text, pageCount: document.pageCount)
    }

    private static func normalize(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\u{0000}", with: "")
            .replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
