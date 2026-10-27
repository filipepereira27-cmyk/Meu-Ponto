# 7. Publicar · 9. Instalar no iPhone · 8. Testes

O portal precisa estar em **HTTPS** (câmera, Face ID e uso offline exigem). As opções abaixo são
gratuitas e já dão HTTPS.

## Opção A — GitHub Pages (recomendada; atualiza sozinho)

1. Crie uma conta em github.com (pode ser pelo iPhone) e um repositório, por exemplo `meu-ponto`.
   Pode ser **privado** se você tiver GitHub Pro; no plano gratuito o Pages exige repositório público
   (o código fica visível, **os seus tickets não** — eles nunca saem do aparelho).
2. Envie esta pasta para o repositório (ou peça ao Claude para enviar, conectando o repositório à sessão).
3. No repositório: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
4. Aba **Actions**: o fluxo "Publicar portal" roda os testes e publica. Em ~3 minutos o portal fica em
   `https://<seu-usuário>.github.io/meu-ponto/`.

Cada novo envio para `main` publica uma nova versão; o portal mostra "Nova versão disponível — Atualizar".

## Opção B — Netlify Drop (sem Git)

Num computador: `npm install && npm run build`, abra <https://app.netlify.com/drop> e arraste a pasta
`dist/`. O endereço sai na hora (ex.: `https://nome-aleatorio.netlify.app`). Crie uma conta para mantê-lo.

## Instalar no iPhone

1. Abra o endereço no **Safari**.
2. Toque em **Compartilhar** (quadrado com seta) › **Adicionar à Tela de Início** › Adicionar.
3. Abra pelo ícone "Meu Ponto". Na primeira vez, toque em "Começar" e, se quiser, ative o Face ID.
4. Deixe o portal aberto alguns segundos com internet: ele baixa o reconhecimento de texto para uso offline.

**Por que instalar:** como app da Tela de Início, o portal abre em tela cheia, funciona sem internet e o
Safari não apaga os dados por falta de uso (sites comuns podem ter dados apagados após semanas sem visita).

**Importante:**
- Os tickets ficam no app instalado *naquele* iPhone. Apagar o ícone da Tela de Início apaga os dados.
- O Safari (aba comum) e o app instalado têm armazenamentos **separados**.
- Faça backup regularmente (Ajustes › Backup e exportação) e salve no iCloud Drive.
- iPhone recomendado: iOS 17 ou mais recente.

## Testes automatizados

| Comando | O que cobre | Situação |
|---|---|---|
| `npm test` | 55 testes: parser (Portarias 671/1510, convencional, borrado, danificado, ambíguo, conflito, formatos de data/hora, CNPJ com erro, CNPJ alfanumérico, ruído), validadores, busca (datas parciais, horários, mês, dia da semana, texto do OCR, 10 mil tickets), filtros, ordem, histórico, duplicidades, jornada (completa, tipos indefinidos, saída ausente, turno noturno, intervalo curto, mês), CSV, backup (ida e volta byte a byte, corrupção, truncado, arquivo estranho), imagem; **OCR real do Tesseract nas fotos de `docs/amostras`** | ✅ 55/55 |
| `npm run test:e2e` | Portal real no Chromium (390×844): boas-vindas; importar e reconhecer; confirmação obrigatória; duplicidade; 12 buscas; recarregar; edição/histórico; calendário/dia; backup → apagar tudo → restaurar → restaurar de novo; arquivo inválido; **offline com OCR**; jornada; sem erros no console | ✅ (raiz e subpasta) |

**Benchmark de OCR** (`tests/ocr.benchmark.test.ts`, roda no `npm test` e na publicação): 15 fotos
sintéticas difíceis em `tests/benchmark/` — 5 modelos de ticket (Henry, Control iD, convencional, REP-P
com CNPJ alfanumérico, NSR na mesma linha) × 3 condições (boa; inclinada 9° com perspectiva e papel
curvado; desbotada com falhas de impressão, sombra, desfoque e baixa resolução). Metas: ≥ 85% dos
campos corretos e **zero** valores errados aceitos sem confirmação.

| Versão | Campos corretos | Erros silenciosos |
|---|---|---|
| 1.0 (um passe) | 48% | 1 |
| 1.1 (recorte, endireitamento, vários passes, rótulos tolerantes) | **90%** | **0** |

Relatório campo a campo: `test-results/ocr-benchmark.txt`. Para gerar novas fotos: `python3 scripts/gerar-benchmark.py`.

Nas amostras, o teste confirma que, quando o OCR erra (ex.: lê `22/10/20` em vez de `22/10/26`), o valor
**nunca passa como confirmado** sem pedir conferência.

## Roteiro de testes manuais no iPhone

Use as imagens de `docs/amostras/` (mande para o iPhone por AirDrop) e, principalmente, **tickets reais**.

| # | Caso | Esperado |
|---|---|---|
| 1 | Fotografar um ticket real com boa luz | Campos preenchidos; confiança alta nos legíveis |
| 2 | Amostra 02 (inclinada, sem tipo) | Tipo pendente; "Salvar e confirmar" bloqueado até escolher |
| 3 | Amostra 03 (desbotada) com e sem "Realce" | Com realce lê muito melhor; duvidosos destacados |
| 4 | Importar a 01 e depois a 04 | Alerta de duplicidade; nada apagado |
| 5 | Amostra 05 (sem data) | "Data não encontrada"; aparece em "incompletos" |
| 6 | Importar 3 fotos juntas | "Ticket 1 de 3"; "Pular" funciona |
| 7 | Buscar `22/10`, `8h01`, nome da empresa, NSR | Encontra |
| 8 | Modo Avião: abrir, fotografar, buscar | Tudo funciona (após o primeiro uso com internet) |
| 9 | Fechar o app, reiniciar o iPhone | Tickets e fotos presentes |
| 10 | Ativar Face ID; sair 1 min; voltar | Pede Face ID |
| 11 | Backup › salvar no iCloud Drive; apagar tudo; restaurar | Tudo volta; restaurar 2× não duplica |
| 12 | PDF do ticket, PDF/CSV da jornada | Abrem em Arquivos/Numbers com acentos corretos |
| 13 | Imprimir | Abre o PDF para AirPrint/compartilhar |
| 14 | Publicar uma versão nova | Aviso "Nova versão disponível"; dados mantidos |
| 15 | VoiceOver, Texto Maior, modo escuro | Rótulos lidos; nada cortado |
