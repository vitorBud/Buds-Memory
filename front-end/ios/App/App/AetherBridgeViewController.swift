import Capacitor

final class AetherBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // O Capacitor 8 ignora registerPluginType quando o autorregistro está
        // ativo. A instância explícita mantém os plugins do Capacitor e também
        // disponibiliza a ponte nativa AetherLocal para o React.
        bridge?.registerPluginInstance(AetherLocalPlugin())
    }
}
