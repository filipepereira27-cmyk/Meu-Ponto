# 12. Plano de melhorias futuras

Prioridade sugerida, do mais útil para o menos.

## Curto prazo (próxima versão)
1. **Compilar e rodar no Xcode**, corrigir eventuais erros de tipo e executar `AppTests` (ver estado em README).
2. **Testes com tickets reais** de vários fabricantes (Henry, Control iD, Dimep, Madis, Topdata…) e
   ajuste das listas de rótulos do `TicketTextParser` com os casos encontrados.
3. **Backup com senha** (AES‑GCM via CryptoKit, chave derivada com PBKDF2/CommonCrypto), opcional.
4. **Backup automático** para uma pasta escolhida (bookmark com escopo de segurança, ex.: iCloud Drive), ao abrir o app quando o último backup estiver vencido.
5. **Recorte automático** também para fotos da galeria (`VNDetectRectanglesRequest` + correção de perspectiva).
6. Destaque na imagem da região de onde cada campo foi lido (caixas do Vision).

## Médio prazo
7. **Importar PDF** (espelho de ponto/relatórios), uma página por ticket.
8. Comparação com o **espelho de ponto da empresa** (AFD/AEJ da Portaria 671): marcações ausentes ou divergentes.
9. **Widget** e **Atalhos/Siri** (“Fotografar ticket”), botão de Ação do iPhone.
10. Ajustes de jornada mais ricos: escalas 12×36, banco de horas, feriados, jornadas diferentes por período (sempre como referência).
11. Lembrete opcional para fotografar o ticket (notificação local no horário habitual).
12. Mesclar manualmente dois tickets duplicados preservando ambos os históricos.

## Longo prazo
13. **Sincronização iCloud opcional** (CloudKit privado), com `SchemaV2`, consentimento e estratégia de conflitos (ver 02-ARQUITETURA).
14. iPad e Mac (Catalyst/Designed for iPad) com arrastar e soltar.
15. Modelo de IA **no aparelho** (Core ML) para classificar layouts e melhorar a extração, sem enviar dados.
16. Tradução para inglês/espanhol (o app já usa textos centralizados nas telas).
17. Relatório para advogado/sindicato com seleção de tickets, índice e imagens em alta resolução.
