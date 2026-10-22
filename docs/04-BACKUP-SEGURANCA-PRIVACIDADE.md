# 10. Backup, restauração e exportação · 11. Checklist de segurança e privacidade

## 10. Backup, restauração e exportação

### Onde os dados ficam
`Application Support/MeuPontoDigital/` dentro do app: banco `MeuPonto.store` e pasta `Comprovantes/`
(`<id>-original.<ext>` com os bytes originais e `<id>-tratada.jpg`). Não aparecem no app Arquivos e
**são apagados se o app for desinstalado**.

### Três camadas de proteção contra perda

| Camada | O que é | Como ativar |
|---|---|---|
| Backup do iPhone | Backup do iCloud/computador inclui os dados do app | Ajustes do iPhone › [seu nome] › iCloud › Backup do iCloud |
| **Backup do app** (`.mpdbackup`) | Arquivo único com todos os tickets, imagens originais, histórico e ajustes | Ajustes › Backup e exportação › **Fazer backup agora** → escolha iCloud Drive, “No meu iPhone”, Google Drive, pen drive… |
| Exportação aberta | Pasta com `tickets.csv`, `dados.json`, `imagens/` e `LEIA-ME.txt` | Ajustes › Backup e exportação › Exportar tudo em pasta |

O app mostra **“Backup em dia / desatualizado / nenhum backup”**, a data do último backup e lembra na
tela inicial depois de 7, 15 ou 30 dias (configurável).

### Restaurar
Ajustes › Backup e exportação › **Restaurar de um backup** › escolha o arquivo › confirme.
- O arquivo inteiro é verificado (CRC32 por entrada) **antes** de gravar qualquer coisa.
- Só adiciona tickets que não existem (mesmo ID): **nada é apagado ou substituído**; restaurar duas vezes não duplica.
- Se algo falhar no meio, as alterações são desfeitas.

### Formato `.mpdbackup` (aberto e documentado)
```
"MPDBKP" + versão (1 byte) + "\n"
repetido: [UInt32 tamanho do nome][nome UTF‑8][UInt64 tamanho][UInt32 CRC32][dados]
```
Entradas: `manifest.json` (todos os tickets em JSON legível) e `images/<arquivo>`.
Lido e gravado em fluxo (uma imagem por vez), adequado a milhares de tickets.

> ⚠️ O arquivo de backup **não tem senha**. Guarde-o em local protegido (iCloud Drive com
> autenticação de dois fatores, por exemplo). Criptografia com senha está no plano de melhorias.

### Exportar um ticket ou relatório
- Detalhe do ticket › “…” › Compartilhar PDF (foto + dados + texto OCR + histórico), foto original, Imprimir.
- Jornada › PDF do mês, CSV da jornada, CSV dos tickets do mês.
- CSV com `;` e UTF‑8 com BOM: abre direto no Excel/Numbers em português com acentos corretos.

## 11. Checklist de segurança e privacidade

### Armazenamento e acesso
- [x] Dados apenas no aparelho; nenhum servidor; `cloudKitDatabase: .none`.
- [x] Imagens gravadas com `FileProtectionType.complete` (ilegíveis com o aparelho bloqueado).
- [x] Pastas criadas com `completeUntilFirstUserAuthentication` (classe padrão do iOS para o banco).
- [x] Bloqueio opcional por Face ID/Touch ID com alternativa pelo código (`deviceOwnerAuthentication`).
- [x] Rebloqueio após 30 s em segundo plano; conteúdo coberto na tela de apps recentes.
- [x] Ativar/desativar a proteção e apagar tudo exigem autenticação do dono.
- [x] Sem código no iPhone: o app avisa e não tranca o usuário fora dos próprios dados.
- [x] Banco não é recriado automaticamente em caso de erro (sem perda silenciosa).
- [ ] Criptografia adicional do banco (SQLCipher ou chave no Keychain) — avaliar se houver exigência corporativa.
- [ ] Backup criptografado com senha (AES‑GCM + PBKDF2) — planejado.

### Rede e terceiros
- [x] Nenhuma requisição de rede no código; OCR local (Vision).
- [x] Sem anúncios, sem SDKs de análise/rastreamento, sem login.
- [x] `PrivacyInfo.xcprivacy`: sem rastreamento, sem coleta; declara apenas `UserDefaults` (CA92.1).
- [x] `ITSAppUsesNonExemptEncryption = false`.
- [x] Compartilhamento só por ação explícita do usuário (folha de compartilhamento/seletor de arquivos).

### Permissões
- [x] Câmera — com justificativa em português.
- [x] Face ID — com justificativa.
- [x] Fotos — via `PhotosPicker` (não exige permissão de acesso à biblioteca inteira).

### LGPD
- [x] Política de privacidade no app (Ajustes › Privacidade) e na primeira abertura.
- [x] Finalidade única e coleta mínima (só o que está no comprovante e o que o usuário digitar).
- [x] Acesso, correção (com histórico), portabilidade (pasta aberta CSV/JSON/imagens) e eliminação (um ou todos).
- [x] Indicação clara de onde os dados ficam (Ajustes › Onde meus dados ficam).
- [x] Nenhum serviço externo; qualquer futuro envio será opcional, desligado por padrão e com consentimento explícito.

### Integridade
- [x] Foto original preservada byte a byte; texto OCR imutável; correções no histórico.
- [x] Nenhum horário impresso é alterado; o app não substitui o ponto oficial (avisos nos relatórios).
- [x] Duplicidades nunca são excluídas automaticamente.
- [x] Exclusões com confirmação explicando que não podem ser desfeitas.
