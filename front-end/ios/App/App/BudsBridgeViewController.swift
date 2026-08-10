import Capacitor

final class BudsBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // O Capacitor 8 ignora registerPluginType quando o autorregistro está
        // ativo. A instância explícita mantém os plugins do Capacitor e também
        // disponibiliza a ponte nativa BudsLocal para o React.
        bridge?.registerPluginInstance(BudsLocalPlugin())
        lockApplicationPageScale()
    }

    private func lockApplicationPageScale() {
        // O conteúdo do Buds já é responsivo. Impedir o zoom nativo da
        // UIScrollView evita a escala permanente do app após duplo toque ou
        // foco em inputs. Gestos do Leaflet continuam sendo tratados no DOM.
        guard let webView else { return }
        let scrollView = webView.scrollView
        scrollView.pinchGestureRecognizer?.isEnabled = false
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 1
        scrollView.setZoomScale(1, animated: false)
    }
}
