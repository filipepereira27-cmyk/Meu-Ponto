import SwiftUI
import SwiftData

@main
struct MeuPontoDigitalApp: App {
    @State private var settings = AppSettings()
    @State private var appLock = AppLock()
    @State private var navigation = AppNavigation()
    private let containerResult: Result<ModelContainer, Error>

    init() {
        containerResult = Result { try PersistenceController.makeContainer() }
    }

    var body: some Scene {
        WindowGroup {
            switch containerResult {
            case .success(let container):
                RootView()
                    .environment(settings)
                    .environment(appLock)
                    .environment(navigation)
                    .modelContainer(container)
            case .failure(let error):
                // Nunca recriar o banco automaticamente: isso poderia apagar registros.
                StorageErrorView(error: error)
            }
        }
    }
}

/// Exibida se o banco de dados não puder ser aberto. Não apaga nada.
struct StorageErrorView: View {
    let error: Error

    var body: some View {
        ContentUnavailableView {
            Label("Não foi possível abrir seus registros", systemImage: "externaldrive.badge.exclamationmark")
        } description: {
            Text("Seus comprovantes não foram apagados. Feche o app e abra novamente. Se o problema continuar, verifique o espaço livre no iPhone ou atualize o app.\n\nDetalhe técnico: \(error.localizedDescription)")
        }
    }
}
