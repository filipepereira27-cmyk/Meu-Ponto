# 4. Arquitetura técnica e 5. Modelo de dados

## Decisões

| Tema | Escolha | Motivo |
|---|---|---|
| iOS mínimo | **17.0** | SwiftData, `@Observable`, `ContentUnavailableView`, OCR em pt-BR. Cobre iPhone XS/XR em diante. |
| Interface | SwiftUI (UIKit só para scanner, câmera, zoom, exportação, impressão) | Nativo, modo claro/escuro, Dynamic Type, VoiceOver. |
| OCR | Apple Vision `VNRecognizeTextRequest` (`.accurate`, `pt-BR`) | No aparelho, gratuito, sem internet, sem assinatura. |
| Captura | VisionKit `VNDocumentCameraViewController` | Detecção de bordas e correção de perspectiva prontas. |
| Persistência | **SwiftData** com `VersionedSchema` + `SchemaMigrationPlan` | Migrações declaradas = atualizações sem perda. |
| Imagens | Arquivos em `Application Support/MeuPontoDigital/Comprovantes` | Banco leve; bytes originais preservados. |
| Proteção | `FileProtectionType.complete` nas imagens; bloqueio com `LocalAuthentication` | Criptografia do iOS + Face ID/código. |
| Lógica de negócio | Pacote Swift **PontoCore** (só Foundation) | Testável fora do iPhone; 43 testes automatizados. |
| iCloud/CloudKit | **Não** no MVP (`cloudKitDatabase: .none`) | Ver seção “Sincronização com iCloud”. |
| Projeto | XcodeGen (`project.yml`) → `MeuPontoDigital.xcodeproj` já gerado | Projeto reproduzível e legível. |

## Camadas

```
┌──────────────────────────── App (iOS, SwiftUI) ────────────────────────────┐
│ Views/            Início · Arquivo · Calendário · Jornada · Ajustes        │
│                   Captura (scanner, editor, revisão) · Detalhe             │
│ Services/         OCRService (Vision) · ImageProcessing (CoreImage)        │
│                   ImageStore (arquivos) · BackupService · ExportService    │
│                   AppLock (Face ID) · AppSettings · AppNavigation          │
│ Models/           SchemaV1 (SwiftData: Ticket, TicketChange) + mapeamento  │
└──────────────────────────────────┬─────────────────────────────────────────┘
                                   │ TicketRecord (valor, Codable)
┌──────────────────────────── PontoCore (Foundation) ─────────────────────────┐
│ TicketTextParser   linhas do OCR → ParsedTicket (campos + confiança)        │
│ DocumentValidators CNPJ (numérico/alfanumérico), CPF, PIS                   │
│ TicketFilter       busca textual + filtros + ordenação cronológica          │
│ DuplicateDetector  códigos, NSR, data/hora/tipo, dHash de imagem            │
│ WorkdayAnalyzer    jornada diária/mensal, pendências, estimativas           │
│ ChangeTracker      diferenças campo a campo para o histórico                │
│ CSVExporter        CSV `;` UTF-8 com BOM (Excel/Numbers pt-BR)              │
│ BackupArchive      formato .mpdbackup em fluxo com CRC32                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Fluxo de um ticket

1. Captura → `ImportedImage` (bytes originais + cópia orientada).
2. Editor → cópia girada/recortada/realçada.
3. `OCRService.recognizeLines` → linhas (fragmentos na mesma altura são unidos: `DATA: …  HORA: …`).
4. `TicketTextParser.parse` → `ParsedTicket` com confiança por campo e avisos.
5. Revisão (`TicketDraft`) → confirmação dos campos críticos.
6. Verificação de duplicidade → gravação: imagem original (bytes intactos), imagem tratada (JPEG),
   registro SwiftData, histórico (inclusão + correções em relação ao OCR).

### Confiança

`confiança do campo = confiança da linha (Vision) × fator da interpretação`

| Situação | Fator |
|---|---|
| Valor com rótulo (`NSR:`, `DATA:`) | 0,95–1,0 |
| Data com ano de 2 dígitos | ×0,95 |
| Caracteres corrigidos (`O→0`) | ×0,75–0,8 |
| Empresa sem rótulo | ×0,6–0,75 + aviso |
| Valores diferentes no mesmo ticket | ×0,6 e sempre abaixo do limite |
| Documento com dígito verificador inválido | ×0,5–0,6 + aviso |

Limite para confirmação: **0,85**. Abaixo disso o campo é destacado.

## Modelo de dados

### `Ticket` (SwiftData, `SchemaV1`)

| Campo | Tipo | Observação |
|---|---|---|
| `id` | UUID (único) | ID do ticket |
| `originalFileName` | String | Nome do arquivo importado ou `Camera-AAAA-MM-DD-HHMMSS.jpg` |
| `imageFileName` | String | Arquivo da **imagem original** (bytes intactos) |
| `processedImageFileName` | String? | Cópia tratada usada no OCR |
| `imageHashBits` | Int64? | dHash 64 bits (duplicidade) |
| `ocrText` | String | Texto integral reconhecido — **nunca alterado** |
| `ocrConfidence` | Double | Média das linhas |
| `fieldConfidencesData` | Data (JSON) | Confiança por campo |
| `ocrSnapshotData` | Data (JSON) | `ParsedTicket` original: valores extraídos antes de qualquer correção |
| `recordDayKey` | String? | Data impressa `yyyy-MM-dd` (sem fuso; ordenável) |
| `recordTimeText` | String? | Horário impresso `HH:mm[:ss]` |
| `markTypeRaw` | String | `entrada`, `saida`, `inicioIntervalo`, `fimIntervalo`, `indefinido` |
| `company`, `cnpj` | String | Empresa |
| `employeeName`, `employeeID` | String | Funcionário / matrícula / PIS / CPF |
| `clockID` | String | REP / relógio |
| `ticketNumber` | String | NSR / nº do ticket |
| `authCode` | String | Código de autenticação |
| `otherFieldsData` | Data (JSON) | Outros pares rótulo/valor |
| `importedAt` | Date | Data/hora de inclusão no app |
| `updatedAt` | Date | Última alteração |
| `isConfirmed` | Bool | Revisão: pendente/confirmada |
| `isFlagged` | Bool | Sinalizado para conferência |
| `notes` | String | Observações pessoais |
| `tags` | [String] | Etiquetas |
| `journeyDayKey` | String? | Associação manual a uma jornada (turno noturno) |
| `changes` | [TicketChange] | Histórico (exclusão em cascata) |

### `TicketChange`
`id`, `date`, `field`, `oldValue`, `newValue`, `ticket`.

### Por que data e hora como texto?
Comprovantes registram a **hora local do relógio**. Guardar como `Date` exigiria escolher um fuso
e poderia mudar o dia ao viajar ou com mudanças de fuso. `yyyy-MM-dd` + `HH:mm` são exatamente o que
está impresso, ordenam corretamente como texto e são fáceis de pesquisar e exportar.

### Migrações (atualizar sem perder registros)
1. Nunca altere `SchemaV1` depois de publicado.
2. Crie `SchemaV2` copiando as classes e aplicando a mudança.
3. Adicione `MigrationStage.lightweight(fromVersion: SchemaV1.self, toVersion: SchemaV2.self)`
   (ou `.custom` para transformar dados) em `TicketMigrationPlan`.
4. Teste abrindo um banco criado pela versão anterior (guarde um `.store` de exemplo).
5. Se o banco não abrir, o app mostra uma tela de erro **sem recriar o banco** (nada é apagado).

## Sincronização com iCloud (não incluída no MVP)

**Hoje:** dados apenas no aparelho. O backup do iPhone (iCloud/computador) inclui os dados do app
se estiver ativo nos Ajustes do iPhone. O backup do app (`.mpdbackup`) pode ser salvo no iCloud Drive.

**Se for implementada (CloudKit via SwiftData):**
- O que sincroniza: os registros (`Ticket`, `TicketChange`) no banco **privado** do usuário no iCloud;
  imagens como `@Attribute(.externalStorage) Data` ou `CKAsset`.
- Requisitos do SwiftData + CloudKit: sem `@Attribute(.unique)`, todas as propriedades opcionais ou com
  valor padrão, relacionamentos opcionais → exige um `SchemaV2` e migração.
- Conflitos: CloudKit usa “último a gravar vence” por registro. Para não perder correções, o
  histórico (`TicketChange`) é só-inclusão (nunca editado), e edições simultâneas no mesmo campo
  ficariam ambas no histórico.
- Exclusões propagam para todos os aparelhos → manter a confirmação dupla e recomendar backup.
- Deve ser **opcional, desligada por padrão**, com explicação e consentimento (LGPD), e conta paga do
  Apple Developer Program (CloudKit não funciona com conta gratuita).

## Estrutura de pastas

```
MeuPontoDigital/
├── MeuPontoDigital.xcodeproj   (gerado pelo XcodeGen)
├── project.yml
├── App/
│   ├── MeuPontoDigitalApp.swift
│   ├── Models/        Schema.swift, Ticket+Record.swift
│   ├── Services/      OCR, imagens, armazenamento, backup, exportação, bloqueio, ajustes
│   ├── Views/         Home, Archive, Calendar, Detail, Capture, Analysis, Settings, Components
│   └── Resources/     Assets.xcassets, PrivacyInfo.xcprivacy
├── AppTests/          SwiftData, backup, OCR com Vision (simulador/aparelho)
├── PontoCore/         Pacote Swift com a lógica + 43 testes
└── docs/              Documentação, protótipo e tickets de amostra
```
