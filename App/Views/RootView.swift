import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppLock.self) private var appLock
    @Environment(AppNavigation.self) private var navigation
    @Environment(\.scenePhase) private var scenePhase
    @State private var didLaunch = false

    var body: some View {
        @Bindable var navigation = navigation
        TabView(selection: $navigation.selectedTab) {
            HomeView()
                .tabItem { Label("Início", systemImage: "house") }
                .tag(AppNavigation.Tab.home)
            ArchiveView()
                .tabItem { Label("Arquivo", systemImage: "tray.full") }
                .tag(AppNavigation.Tab.archive)
            CalendarScreen()
                .tabItem { Label("Calendário", systemImage: "calendar") }
                .tag(AppNavigation.Tab.calendar)
            if settings.analysisEnabled {
                AnalysisView()
                    .tabItem { Label("Jornada", systemImage: "chart.bar.doc.horizontal") }
                    .tag(AppNavigation.Tab.analysis)
            }
            SettingsView()
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
                .tag(AppNavigation.Tab.settings)
        }
        .overlay {
            if appLock.isLocked {
                LockView()
                    .transition(.opacity)
            } else if scenePhase != .active && settings.lockEnabled {
                // Esconde os comprovantes na tela de apps recentes.
                PrivacyCover()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: appLock.isLocked)
        // App exclusivamente em português do Brasil (datas dd/mm/aaaa, horário 24h).
        .environment(\.locale, Locale(identifier: "pt_BR"))
        .onAppear {
            guard !didLaunch else { return }
            didLaunch = true
            appLock.lockOnLaunch(enabled: settings.lockEnabled)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: appLock.didEnterBackground(enabled: settings.lockEnabled)
            case .active: appLock.willEnterForeground(enabled: settings.lockEnabled)
            default: break
            }
        }
        .sheet(isPresented: Binding(
            get: { !settings.hasCompletedOnboarding && !appLock.isLocked },
            set: { if !$0 { settings.hasCompletedOnboarding = true } }
        )) {
            OnboardingView()
                .interactiveDismissDisabled()
        }
    }
}

struct LockView: View {
    @Environment(AppLock.self) private var appLock

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Meu Ponto Digital")
                .font(.title.bold())
            Text("Seus comprovantes estão protegidos.")
                .foregroundStyle(.secondary)
            if let message = appLock.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                Task { await appLock.unlock() }
            } label: {
                Label("Desbloquear com \(appLock.biometryName)", systemImage: appLock.biometrySymbol)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(appLock.isAuthenticating)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .task { await appLock.unlock() }
    }
}

struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThickMaterial)
            Image(systemName: "lock.fill")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
