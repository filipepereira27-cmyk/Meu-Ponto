# Meu Ponto Digital

Portal web (PWA) para **digitalizar, organizar e consultar tickets impressos de registro de ponto**.
Fotografe hoje e encontre o comprovante meses depois por data, horário ou conteúdo — com a foto
original preservada e os dados extraídos para conferência.

Abre por um link em qualquer navegador e, no iPhone, pode ser **instalado na Tela de Início** como
um app. **Os tickets ficam no próprio aparelho**: não há login, servidor de dados nem envio de fotos.

- 📷 Fotografar ou importar fotos/arquivos (vários de uma vez)
- ✂️ Recortar, girar e realçar antes do reconhecimento
- 🔤 OCR **no próprio aparelho** (Tesseract em WebAssembly, português) — funciona sem internet
- ✅ Confiança por campo; data, horário e tipo duvidosos **exigem confirmação**
- 🗂️ Busca por `22/10`, `8h01`, `outubro`, `quinta-feira`, empresa, NSR, qualquer texto do ticket
- 📅 Calendário, dia de trabalho, associação manual de turnos noturnos
- 🧮 Análise opcional da jornada (sempre como **referência/estimativa**), PDF e CSV
- 🔐 Face ID / código (chave de acesso do aparelho), backup `.zip` aberto, restauração sem perda

![Telas](docs/telas/05-inicio.png)

## Estado

| Verificação | Resultado |
|---|---|
| Testes do núcleo (`npm test`): parser, busca, duplicidades, jornada, CSV, backup, **OCR real nas fotos de amostra** | ✅ 56/56 |
| Benchmark de OCR: 15 fotos difíceis (inclinadas, curvadas, desbotadas) | ✅ 90% dos campos corretos, 0 erros aceitos sem confirmação (era 48%) |
| Teste de ponta a ponta no navegador (`npm run test:e2e`, Chromium em tamanho de iPhone): importar → OCR → revisar → salvar → duplicidade → busca → recarregar → editar/histórico → calendário → backup → apagar → restaurar (2×) → **uso sem internet com OCR** | ✅ passa, sem erros no console, na raiz e em subpasta |
| Verificação de tipos (`tsc`) e build de produção | ✅ |
| Teste em iPhone/Safari real | ⏳ ainda não feito — o Chromium não reproduz tudo do Safari (câmera, Face ID, instalação) |

## Publicar (escolha um)

**GitHub Pages (recomendado, grátis):** envie este repositório para o GitHub, depois em
*Settings › Pages › Source* escolha **GitHub Actions**. O fluxo `.github/workflows/publicar.yml` roda
os testes e publica em `https://<usuário>.github.io/<repositório>/` a cada envio para a branch `main`.

**Netlify (sem Git):** rode `npm run build` e arraste a pasta `dist/` em
<https://app.netlify.com/drop>.

Detalhes, instalação no iPhone e roteiro de testes: [docs/03-PUBLICAR-INSTALAR-TESTAR.md](docs/03-PUBLICAR-INSTALAR-TESTAR.md).

## Desenvolver

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # núcleo + OCR nas amostras
npm run build        # gera dist/
npm run test:e2e     # ponta a ponta (usa dist/)
```

## Documentação

| # | Conteúdo | Arquivo |
|---|---|---|
| 1, 2, 3 | Especificação, fluxo de telas e telas reais | [docs/01-ESPECIFICACAO-E-TELAS.md](docs/01-ESPECIFICACAO-E-TELAS.md) |
| 4, 5 | Arquitetura e modelo de dados | [docs/02-ARQUITETURA-E-DADOS.md](docs/02-ARQUITETURA-E-DADOS.md) |
| 7, 8, 9 | Publicar, instalar no iPhone, testes | [docs/03-PUBLICAR-INSTALAR-TESTAR.md](docs/03-PUBLICAR-INSTALAR-TESTAR.md) |
| 10, 11 | Backup/restauração e checklist de segurança e LGPD | [docs/04-BACKUP-SEGURANCA-PRIVACIDADE.md](docs/04-BACKUP-SEGURANCA-PRIVACIDADE.md) |
| 12 | Melhorias futuras | [docs/05-MELHORIAS-FUTURAS.md](docs/05-MELHORIAS-FUTURAS.md) |

## Limites

- O OCR pode errar; o comprovante original é sempre a referência.
- O portal não altera horários impressos e **não substitui o sistema oficial de ponto**.
- A análise compara com a jornada configurada; não afirma horas extras, atrasos, faltas ou infrações.
- Dados só no navegador do aparelho: **faça backups**. No iPhone, instale na Tela de Início.
