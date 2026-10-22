# 4. Arquitetura · 5. Modelo de dados

## Decisões

| Tema | Escolha | Motivo |
|---|---|---|
| Formato | **PWA** (site instalável) | Acesso por link, sem loja nem Mac; instalável na Tela de Início do iPhone. |
| Dados | **IndexedDB no aparelho** | Privacidade (sem servidor de dados, sem LGPD de terceiros), grátis, funciona offline. |
| OCR | **Tesseract.js 7** (WebAssembly), modelo `por` LSTM | Roda no navegador; nada sai do aparelho. Arquivos servidos pelo próprio portal. |
| Pré-processamento | Cinza → contraste (percentis) → ampliação → binarização adaptativa (Sauvola) | Nas amostras, recuperou o ticket borrado (de 0 para todos os campos). |
| Interface | React 19 + TypeScript, CSS próprio (claro/escuro), rotas por `#` | Leve, funciona em qualquer hospedagem estática. |
| Offline | Service worker (Workbox): telas pré-carregadas; motor do OCR guardado no primeiro uso | Só a variante do motor usada pelo aparelho é baixada (~4 MB + 1,4 MB do idioma). |
| PDF | jsPDF | Gerado no aparelho. |
| Backup | `.zip` comum (fflate) com manifesto JSON, CSV, imagens e CRC32 | Abre em qualquer computador; lido/gravado em fluxo. |
| Proteção | WebAuthn (chave de acesso do aparelho: Face ID / Touch ID / código) | Sem servidor; ver limites em 04. |
| Hospedagem | Estática: GitHub Pages (workflow incluso), Netlify, Cloudflare Pages | Grátis; HTTPS obrigatório (câmera, Face ID, service worker). |

## Camadas

```
src/core/      TypeScript puro, testado em Node (sem navegador)
  parser.ts      linhas do OCR → campos + confiança + avisos
  validators.ts  CNPJ (numérico/alfanumérico), CPF, PIS
  imageOps.ts    cinza, contraste, redimensionar, Sauvola, rotação, dHash
  archive.ts     busca/filtros, histórico (diff), duplicidades
  workday.ts     jornada diária/mensal, pendências, CSV
  backup.ts      .zip em fluxo + CRC32
  calendar.ts    datas/horas civis (texto, sem fuso)
src/services/  navegador: IndexedDB, OCR (Tesseract), canvas, PDF, compartilhar, WebAuthn, backup
src/ui/        React: store, rotas, telas
```

Fluxo de um ticket: arquivo → editor (cópia girada/recortada) → realce → OCR → `parseTicket` → revisão
(rascunho com confirmações) → checagem de duplicidade → transação única no IndexedDB com o ticket, a
**foto original (Blob intacto)**, a cópia recortada e a miniatura.

Confiança do campo = confiança da linha (Tesseract) × fator da interpretação (rótulo 0,95–1; ano com 2
dígitos ×0,95; caracteres corrigidos ×0,75; empresa sem rótulo ×0,6–0,75; valores conflitantes ×0,6 e
abaixo do limite; dígito verificador inválido ×0,5–0,6). Limite para confirmação: **0,85**.

## Modelo de dados (IndexedDB `meu-ponto-digital`, versão 1)

**`tickets`** (chave `id`, índice `recordDate`) — `TicketRecord`:

| Campo | Tipo | Observação |
|---|---|---|
| `id` | string (UUID) | |
| `originalFileName`, `originalMimeType` | string | Nome/tipo do arquivo recebido |
| `hasProcessedImage` | boolean | Existe cópia recortada |
| `imageHash` | string? | dHash 64 bits (hex) para duplicidade |
| `ocrText` | string | Texto integral — **nunca alterado** |
| `ocrConfidence`, `fieldConfidences` | number, mapa | Confiança média e por campo |
| `ocrSnapshot` | ParsedTicket | Valores extraídos antes de qualquer correção |
| `recordDate` | `aaaa-mm-dd`? | Data impressa (sem fuso; ordenável) |
| `recordTime` | `HH:MM[:SS]`? | Horário impresso |
| `markType` | `entrada` \| `saida` \| `inicioIntervalo` \| `fimIntervalo` \| `indefinido` | |
| `company`, `cnpj`, `employeeName`, `employeeID`, `clockID`, `ticketNumber`, `authCode` | string | |
| `otherFields` | {label, value}[] | Outras informações do comprovante |
| `importedAt`, `updatedAt` | ISO 8601 | Inclusão e última alteração |
| `isConfirmed`, `isFlagged` | boolean | Revisão / sinalizado |
| `notes`, `tags` | string, string[] | |
| `journeyDate` | `aaaa-mm-dd`? | Associação manual de jornada |
| `changes` | {id, date, field, oldValue, newValue}[] | Histórico |

**`images`** (chave `"<id>:original" | ":tratada" | ":miniatura"`, índice `ticketId`) — `{ blob }`.
**`settings`** — ajustes (jornada, proteção, último backup, lembretes).

**Migrações:** cada mudança incrementa `DB_VERSION` em `src/services/db.ts` e acrescenta um passo
`if (oldVersion < N)` no `upgrade`; passos antigos nunca mudam. Registros existentes não são recriados.

## Por que não há sincronização entre aparelhos

Foi a escolha feita: dados só no aparelho. Para levar os tickets a outro aparelho, use backup →
restaurar. Uma sincronização futura exigiria servidor/conta (ver 05), com consentimento explícito.
