# Meu Ponto Digital

App para iPhone (iOS 17+, SwiftUI, português do Brasil) que digitaliza, organiza e preserva
**tickets impressos de registro de ponto**: fotografe hoje, encontre meses depois por data,
horário ou conteúdo — com a foto original preservada e os dados extraídos para conferência.

- 📷 Fotografar (scanner com correção de perspectiva), importar da galeria ou do app Arquivos
- ✂️ Recortar, girar e realçar antes do reconhecimento
- 🔤 OCR **no próprio iPhone** (Apple Vision, pt‑BR) — sem internet, sem assinatura
- ✅ Confiança por campo; data, horário e tipo duvidosos **exigem confirmação**
- 🗂️ Arquivo pesquisável (`22/10`, `8h01`, `outubro`, nome da empresa, NSR…) e filtros
- 📅 Calendário, dia de trabalho, associação manual de turnos noturnos
- 🧮 Análise opcional da jornada (sempre como **referência/estimativa**), PDF e CSV
- 🔐 Face ID, proteção de dados do iOS, backup/restauração sem perda, exportação aberta (LGPD)

## Estado atual — leia antes de usar

| Parte | Situação |
|---|---|
| **PontoCore** (parser de OCR, busca, duplicidades, jornada, CSV, backup) | ✅ Compilado e **43/43 testes passando** (Swift 6.0.3, Linux) |
| `MeuPontoDigital.xcodeproj` | ✅ Gerado pelo XcodeGen 2.42 a partir de `project.yml` |
| App iOS (SwiftUI, SwiftData, Vision, VisionKit) | ⚠️ Escrito completo e revisado, **sintaxe verificada**, mas **não compilado nem executado**: o ambiente de desenvolvimento era Linux, sem Xcode/SDK do iOS |
| `AppTests` (SwiftData, backup, OCR real com Vision) | ⚠️ Escritos, **ainda não executados** |

Primeiro passo no Mac: abrir o projeto, compilar (⌘B) e rodar os testes (⌘U). Se surgir algum erro
de compilação, envie a mensagem do Xcode para correção. Nenhuma funcionalidade do app deve ser
considerada pronta antes de passar por essa etapa e pelo roteiro de testes manuais.

## Começar

```bash
open MeuPontoDigital.xcodeproj      # Xcode 15.4+ (recomendado 16+)
# ⌘R no simulador · instruções para o iPhone em docs/03
cd PontoCore && swift test          # testes do núcleo, sem simulador
```

## Documentação (entregáveis)

| # | Entregável | Onde |
|---|---|---|
| 1, 2 | Especificação funcional e fluxo de telas | [docs/01-ESPECIFICACAO-E-TELAS.md](docs/01-ESPECIFICACAO-E-TELAS.md) |
| 3 | Protótipo visual (6 telas) | [Artifact](https://claude.ai/artifact/Fh62W8ktAGnvSHxKXZBhdH) · fontes em `docs/prototipo/` |
| 4, 5 | Arquitetura técnica e modelo de dados (+ iCloud) | [docs/02-ARQUITETURA-E-DADOS.md](docs/02-ARQUITETURA-E-DADOS.md) |
| 6 | Código-fonte | `App/`, `PontoCore/`, `AppTests/` |
| 7, 8, 9 | Xcode, testes automatizados/manuais, instalação no iPhone | [docs/03-XCODE-INSTALACAO-TESTES.md](docs/03-XCODE-INSTALACAO-TESTES.md) |
| 10, 11 | Backup/restauração/exportação e checklist de segurança e LGPD | [docs/04-BACKUP-SEGURANCA-PRIVACIDADE.md](docs/04-BACKUP-SEGURANCA-PRIVACIDADE.md) |
| 12 | Melhorias futuras | [docs/05-MELHORIAS-FUTURAS.md](docs/05-MELHORIAS-FUTURAS.md) |

Tickets de exemplo para testes manuais (nítido, inclinado, desbotado, foto repetida, danificado):
`docs/amostras/`.

## Limites assumidos

- O OCR pode errar; o comprovante original é sempre a referência.
- O app não altera horários impressos e **não substitui o sistema oficial de ponto** da empresa.
- A análise compara com a jornada configurada pelo usuário; não afirma horas extras, atrasos, faltas ou infrações.
