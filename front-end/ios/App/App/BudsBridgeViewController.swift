import Capacitor

final class BudsBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // O Capacitor 8 ignora registerPluginType quando o autorregistro está
        // ativo. A instância explícita mantém os plugins do Capacitor e também
        // disponibiliza a ponte nativa BudsLocal para o React.
        bridge?.registerPluginInstance(BudsLocalPlugin())
    }
}
