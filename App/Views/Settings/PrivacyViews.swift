import SwiftUI

struct PrivacyPolicyView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Group {
                    Text("Política de privacidade").font(.title2.bold())
                    Text("Versão 1.0 — vale para o app Meu Ponto Digital.").font(.footnote).foregroundStyle(.secondary)

                    policy("Quais dados o app trata",
                           "Fotografias de comprovantes de registro de ponto e as informações impressas neles (nome, matrícula, PIS/CPF, empresa, CNPJ, data, horário, códigos), além das observações e etiquetas que você adicionar. São dados pessoais e são tratados como confidenciais.")
                    policy("Para que são usados",
                           "Somente para organizar, consultar e analisar os seus próprios comprovantes, a seu pedido. O app não faz nenhum outro uso.")
                    policy("Onde ficam",
                           "Exclusivamente neste iPhone, dentro da área protegida do app, com a proteção de dados do iOS (criptografia enquanto o aparelho está bloqueado). O reconhecimento de texto (OCR) é feito no próprio aparelho. Não existe servidor do app.")
                    policy("Compartilhamento",
                           "Nenhum. O app não envia fotos ou dados para a internet, não tem anúncios, não usa rastreamento nem ferramentas de análise de terceiros. Um ticket só sai do aparelho quando você toca em compartilhar, exportar, imprimir ou salvar um backup — e você escolhe o destino.")
                }
                Group {
                    policy("Backups",
                           "O backup do app é um arquivo que você salva onde quiser. Ele não tem senha: guarde-o em local seguro. Se o backup do iPhone (iCloud/computador) estiver ativado, os dados do app são incluídos nele, conforme as regras da Apple.")
                    policy("Seus direitos (LGPD)",
                           "Você pode, a qualquer momento: consultar todos os dados (no próprio app); corrigir qualquer informação (as correções ficam no histórico); exportar tudo em formato aberto (Ajustes › Backup e exportação); e excluir um ticket ou todos os dados (Ajustes › Privacidade). Como os dados não saem do aparelho, não há pedido a fazer a terceiros.")
                    policy("Serviços externos",
                           "A versão atual não usa nenhum serviço externo. Se no futuro algum recurso opcional precisar enviar dados (por exemplo, sincronização), ele ficará desligado por padrão e pedirá o seu consentimento explícito antes.")
                    policy("Limites do app",
                           "Os dados extraídos por OCR podem conter erros. O comprovante original é a referência. O app não altera horários impressos e não substitui o sistema oficial de ponto da empresa.")
                }
            }
            .padding()
        }
        .navigationTitle("Privacidade")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func policy(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Text(text).font(.body)
        }
    }
}

struct StorageInfoView: View {
    let ticketCount: Int
    @State private var imagesSize: Int64 = 0

    var body: some View {
        List {
            Section {
                LabeledContent("Tickets", value: "\(ticketCount)")
                LabeledContent("Espaço das imagens", value: ByteCountFormatter.string(fromByteCount: imagesSize, countStyle: .file))
                LabeledContent("Local", value: "Somente neste iPhone")
                LabeledContent("Proteção", value: "Criptografia do iOS")
                LabeledContent("Envio para a internet", value: "Nunca automático")
            }
            Section {
                Text("Os arquivos ficam na área privada do app (Application Support), invisível para outros apps e para o app Arquivos. Ao desinstalar o app, eles são apagados — por isso faça backups.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Onde meus dados ficam")
        .task {
            imagesSize = await Task.detached { ImageStore.shared.totalSize() }.value
        }
    }
}

/// Apresentação na primeira abertura: transparência sobre privacidade e limites do OCR.
struct OnboardingView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppLock.self) private var appLock
    @State private var enableLock = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: "doc.text.viewfinder")
                        .font(.system(size: 48))
                        .foregroundStyle(.tint)
                    Text("Bem-vindo ao Meu Ponto Digital").font(.largeTitle.bold())
                    Text("Fotografe seus tickets de ponto e encontre qualquer um deles depois, por data, horário ou conteúdo.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                point("lock.iphone", "Tudo fica no seu iPhone",
                      "Fotos e dados não são enviados para a internet. O texto é reconhecido no próprio aparelho.")
                point("checkmark.seal", "Você confere, o app organiza",
                      "O reconhecimento automático pode errar. Quando houver dúvida na data, no horário ou no tipo, o app pede sua confirmação.")
                point("photo", "O original é preservado",
                      "A foto original é guardada sem alterações. Correções ficam registradas no histórico.")
                point("externaldrive", "Faça backups",
                      "Salve cópias regularmente em Ajustes › Backup e exportação.")

                if appLock.deviceSupportsLock {
                    Toggle(isOn: $enableLock) {
                        Label("Proteger com \(appLock.biometryName)", systemImage: appLock.biometrySymbol)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                }

                Button {
                    settings.lockEnabled = enableLock && appLock.deviceSupportsLock
                    settings.hasCompletedOnboarding = true
                } label: {
                    Text("Começar").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                NavigationLink("Ler a política de privacidade") { PrivacyPolicyView() }
                    .font(.footnote)
            }
            .padding(24)
        }
        .embedInNavigation()
    }

    private func point(_ symbol: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text).font(.callout).foregroundStyle(.secondary)
            }
        }
    }
}

private extension View {
    func embedInNavigation() -> some View {
        NavigationStack { self }
    }
}
