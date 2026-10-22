# 7. Abrir e compilar no Xcode · 9. Instalar no iPhone · 8. Testes

## Requisitos

- Mac com **Xcode 15.4 ou mais recente** (recomendado Xcode 16+).
- iPhone com **iOS 17 ou mais recente** (iPhone XS/XR em diante).
- Apple ID (gratuito serve para instalar no seu próprio iPhone).

## 7. Abrir e compilar

1. Copie a pasta `MeuPontoDigital` para o Mac.
2. Dê dois cliques em **`MeuPontoDigital.xcodeproj`**.
3. Aguarde o Xcode resolver o pacote local **PontoCore** (aparece em “Package Dependencies”).
4. Selecione o esquema **MeuPontoDigital** e um simulador (ex.: iPhone 15).
5. **⌘B** para compilar, **⌘R** para executar.

> Se você alterar `project.yml` ou adicionar arquivos: `brew install xcodegen && xcodegen generate`.
> Alternativa sem XcodeGen: crie um projeto App (SwiftUI, iOS 17) chamado MeuPontoDigital, apague os
> arquivos gerados, arraste a pasta `App/` para o projeto, adicione o pacote local `PontoCore`
> (File › Add Package Dependencies › Add Local…) e copie as chaves de `App/Info.plist`.

### Se aparecer erro de compilação
O núcleo (`PontoCore`) foi compilado e testado; a camada iOS foi escrita e revisada, mas **não pôde ser
compilada no ambiente onde foi desenvolvida (Linux, sem SDK do iOS)**. Erros pontuais de tipo são
possíveis na primeira compilação. Copie a mensagem do Xcode (Report Navigator ⌘9) e envie para correção.

## 9. Instalar no iPhone

1. Xcode › Settings › Accounts › “+” › Apple ID.
2. No projeto, alvo **MeuPontoDigital** › **Signing & Capabilities**:
   - marque *Automatically manage signing*;
   - **Team**: seu nome (Personal Team);
   - se o Bundle Identifier já estiver em uso, troque `br.com.meupontodigital.app` por algo único
     (ex.: `br.com.seunome.meuponto`).
3. Conecte o iPhone por cabo (ou mesma rede Wi‑Fi após o primeiro pareamento) e confie no computador.
4. iPhone › Ajustes › Privacidade e Segurança › **Modo de Desenvolvedor** › ativar (reinicia o aparelho).
5. Escolha o iPhone como destino e **⌘R**.
6. Na primeira vez: Ajustes › Geral › VPN e Gerenciamento de Dispositivos › confie no seu perfil de desenvolvedor.

**Conta gratuita:** o app expira em **7 dias** e precisa ser reinstalado pelo Xcode (os dados
permanecem se você não apagar o app). Com o Apple Developer Program (US$ 99/ano) vale por 1 ano e
permite TestFlight. **Faça backups** antes de qualquer reinstalação.

## 8. Testes

### Automatizados

| Conjunto | Onde roda | Como | Situação |
|---|---|---|---|
| `PontoCore/Tests` (43 testes) | Mac, Linux, Xcode | `cd PontoCore && swift test` ou ⌘U no Xcode | **43/43 passando** (Swift 6.0.3, Linux) |
| `AppTests/PersistenceTests` | Simulador/iPhone | ⌘U no esquema MeuPontoDigital | Escrito; **ainda não executado** |
| `AppTests/OCRPipelineTests` | Simulador/iPhone | ⌘U | Escrito; **ainda não executado** |

O que o `PontoCore` cobre: tickets nítidos, borrados (dígitos trocados), danificados (sem data),
ambíguos (duas datas, cabeçalho “entrada e saída”), tipos conflitantes; formatos de data e hora;
CNPJ numérico, alfanumérico e com erro de OCR; CPF/PIS; busca por data parcial, horário em várias
grafias, mês, dia da semana, texto do OCR; filtros; ordenação pela data impressa; 10 mil tickets;
histórico; duplicidade por NSR, código, data/hora e imagem; jornada completa, tipos indefinidos
(sem presumir), saída ausente, entrada sem saída, intervalo curto, turno noturno associado; resumo
mensal; CSV; backup ida e volta byte a byte, corrupção, arquivo truncado e arquivo estranho.

O que os testes do app cobrem: SwiftData (ida e volta, histórico, exclusão em cascata), imagem
original byte a byte com proteção de arquivo, backup → restauração em “aparelho novo” sem perda e
sem duplicar, backup corrompido sem alterar nada, OCR real do Vision em ticket nítido, girado e
borrado/desbotado (nunca aceitar valor errado sem pedir confirmação), recorte/rotação e hash.

### Manuais (roteiro)

Use as imagens de `docs/amostras/` — arraste-as para o simulador (vão para o app Fotos).

| # | Caso | Passos | Esperado |
|---|---|---|---|
| 1 | Ticket nítido | Importar `01-nitido…` › Reconhecer | Data 22/10/2026, 08:01, Entrada, CNPJ, NSR; confiança alta; “Salvar e confirmar” habilitado |
| 2 | Inclinado, sem tipo | Importar `02-inclinado…` | Data/hora corretas; **tipo pendente**; “Salvar e confirmar” bloqueado até escolher o tipo |
| 3 | Borrado/desbotado | `03-desbotado…`, com e sem “Realce” | Campos duvidosos destacados; nada confirmado automaticamente |
| 4 | Foto repetida | Salvar `01`, depois importar `04-foto-repetida…` | Alerta de possível duplicidade; nada apagado; pode salvar mesmo assim |
| 5 | Danificado | `05-danificado…` | “Data do registro não encontrada”; salvar como pendente; aparece em “incompletos” |
| 6 | Várias fotos | Importar 01, 06 juntas | “Ticket 1 de 2”, “Pular” funciona |
| 7 | Busca | Arquivo: `22/10`, `8:01`, `8h01`, `padaria`, `outubro`, `000012345` | Ticket encontrado em todos |
| 8 | Filtros | Tipo = Saída; faixa 17h–18h; somente pendentes | Resultados coerentes; contador de filtros |
| 9 | Calendário/dia | Outubro/2026 › dia 22 | 08:01 Entrada, 17:32 Saída, +9h31; resumo da jornada |
| 10 | Turno noturno | Ticket de 23/10 06:00 › segurar › “Pertence à jornada de 22/10” | Aparece no dia 22; histórico registra |
| 11 | Edição e histórico | Detalhe › Editar › mudar horário | Texto OCR inalterado; histórico “08:01 → 08:07” |
| 12 | Sem internet | Modo Avião › fotografar e buscar | Tudo funciona |
| 13 | Persistência | Fechar o app (deslizar), reiniciar o iPhone | Tickets e imagens presentes |
| 14 | Face ID | Ajustes › ativar › ir para Home 30 s › voltar | Pede Face ID; tela de apps recentes coberta |
| 15 | Backup | Backup e exportação › Fazer backup › salvar no iCloud Drive | Data do último backup atualizada |
| 16 | Restauração | Apagar o app, reinstalar, Restaurar | Todos os tickets e fotos de volta; restaurar 2× não duplica |
| 17 | PDF/CSV | Detalhe › Compartilhar PDF; Jornada › PDF/CSV | Abrem no Arquivos/Numbers; acentos corretos |
| 18 | Impressão | Detalhe › Imprimir | Diálogo do AirPrint (no simulador: Printer Simulator) |
| 19 | Grande volume | Importar 100+ fotos (em lotes de 10) | Busca e rolagem fluidas |
| 20 | Atualização | Instalar versão nova por cima | Nenhum registro perdido |
| 21 | Acessibilidade | VoiceOver, Texto Grande, modo escuro | Rótulos lidos; nada cortado; contraste ok |
| 22 | Excluir | Detalhe › Excluir; Ajustes › Apagar tudo | Confirmação; Face ID para apagar tudo |
