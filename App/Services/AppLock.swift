import Foundation
import LocalAuthentication
import Observation

/// Bloqueio do app com Face ID / Touch ID ou o código do iPhone.
@Observable
final class AppLock {
    private(set) var isLocked = false
    private(set) var isAuthenticating = false
    var message: String?

    /// Quando o app foi para segundo plano (para o período de tolerância).
    private var backgroundedAt: Date?
    /// Tempo em segundo plano antes de bloquear novamente.
    let gracePeriod: TimeInterval = 30

    /// Tipo de biometria disponível, para textos e ícones.
    var biometryName: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return "código do iPhone"
        }
    }

    var biometrySymbol: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch context.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        default: return "lock.fill"
        }
    }

    /// O aparelho tem código configurado (requisito para proteger o app).
    var deviceSupportsLock: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    func lockOnLaunch(enabled: Bool) {
        isLocked = enabled && deviceSupportsLock
    }

    func didEnterBackground(enabled: Bool) {
        guard enabled else { return }
        backgroundedAt = Date()
    }

    func willEnterForeground(enabled: Bool) {
        guard enabled, let backgroundedAt else { return }
        if Date().timeIntervalSince(backgroundedAt) > gracePeriod, deviceSupportsLock { isLocked = true }
        self.backgroundedAt = nil
    }

    @MainActor
    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        let context = LAContext()
        context.localizedCancelTitle = "Cancelar"
        do {
            // .deviceOwnerAuthentication: biometria com alternativa pelo código do aparelho.
            let success = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                           localizedReason: "Desbloqueie para acessar seus comprovantes de ponto.")
            if success {
                isLocked = false
                message = nil
            }
        } catch let error as LAError where error.code == .passcodeNotSet {
            // Sem código no aparelho não há como autenticar; não bloqueia o acesso aos próprios dados.
            isLocked = false
            message = "Configure um código no iPhone para proteger o app."
        } catch let error as LAError where error.code == .userCancel || error.code == .appCancel || error.code == .systemCancel {
            message = nil
        } catch {
            message = "Não foi possível desbloquear. Tente novamente."
        }
    }

    /// Confirma a identidade antes de ativar/desativar o bloqueio ou apagar dados.
    @MainActor
    func confirmOwner(reason: String) async -> Bool {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return true }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}
