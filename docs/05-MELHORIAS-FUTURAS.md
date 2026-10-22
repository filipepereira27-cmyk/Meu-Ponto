# 12. Melhorias futuras

## Curto prazo
1. **Testes no iPhone real** (Safari e app instalado) e com **tickets reais** de vários fabricantes
   (Henry, Control iD, Dimep, Madis, Topdata…); ajustar rótulos do parser com os casos encontrados.
2. **Criptografia dos dados** com chave derivada da chave de acesso (WebAuthn PRF, iOS 18+).
3. **Backup com senha** (AES‑GCM, chave via PBKDF2).
4. **Detecção automática das bordas** do ticket e correção de perspectiva em fotos inclinadas.
5. Destacar na foto a região de onde cada campo foi lido.
6. Lembrete de backup mais ativo e opção de backup para pasta escolhida (File System Access, onde houver).

## Médio prazo
7. Importar **PDF** (espelho de ponto) e comparar com AFD/AEJ da Portaria 671.
8. Escalas 12×36, banco de horas, feriados (sempre como referência).
9. Mesclar duplicidades preservando os dois históricos.
10. Atalhos (`?acao=fotografar`) e compartilhar foto direto para o portal (Web Share Target, onde suportado).

## Longo prazo (exige decisão sobre dados na nuvem)
11. **Sincronização opcional entre aparelhos** com conta e criptografia de ponta a ponta (o servidor
    guardaria só dados cifrados), desligada por padrão e com consentimento.
12. Relatório para advogado/sindicato com seleção de tickets e imagens em alta resolução.
13. Versão em inglês/espanhol.
