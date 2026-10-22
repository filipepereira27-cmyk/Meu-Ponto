# 10. Backup, restauração e exportação · 11. Segurança e privacidade

## Onde os dados ficam

No armazenamento privado do navegador para o endereço do portal (IndexedDB), **somente no aparelho**.
O site não tem servidor de dados. Consequências:

- Outra pessoa que abra o mesmo link vê um portal **vazio** (os dados são do aparelho).
- Apagar dados do site, remover o app da Tela de Início ou trocar de aparelho **apaga os tickets** → backup.
- Safari em aba comum e app instalado guardam dados separados.
- O portal pede armazenamento persistente (`navigator.storage.persist()`) ao salvar o primeiro ticket.

## Backup

Ajustes › Backup e exportação › **Fazer backup agora** gera `MeuPontoDigital-backup-AAAAMMDD-HHMM.zip`:

```
manifest.json   todos os tickets (texto do OCR, histórico), ajustes e CRC32 de cada imagem
tickets.csv     planilha (abre no Excel/Numbers)
imagens/        <id>-original.<ext> (bytes intactos) e <id>-tratada.jpg
LEIA-ME.txt
```

É um zip comum: abre em qualquer computador (portabilidade, LGPD). No iPhone, a folha de
compartilhamento permite **Salvar em Arquivos › iCloud Drive**. O portal mostra a data do último backup e
lembra a cada 7/15/30 dias. ⚠️ O arquivo **não tem senha**: guarde-o em local protegido.

## Restaurar

Ajustes › Backup e exportação › **Restaurar de um backup (.zip)** › confirmar.
- Cada imagem é verificada (CRC32); arquivo danificado, incompleto ou estranho é recusado.
- Só adiciona tickets que não existem; **nada é apagado ou substituído**; restaurar 2× não duplica.
- Se algo falhar no meio, as imagens gravadas nessa restauração são removidas.
- Serve também para **levar os tickets para outro aparelho**.

## Exportar

Ticket: PDF (foto + dados + texto + histórico), foto original, imprimir. Jornada: PDF e CSV do mês.
Arquivo inteiro: CSV. CSV usa `;` e UTF‑8 com BOM (Excel/Numbers em português).

## Checklist de segurança e privacidade

**Dados e acesso**
- [x] Sem servidor de dados, sem login, sem sincronização; tudo no IndexedDB do aparelho.
- [x] Fotos e dados nunca enviados automaticamente; compartilhar/exportar só por ação do usuário.
- [x] OCR local (WebAssembly); motor e idioma servidos pelo próprio portal, sem CDN de terceiros.
- [x] Content-Security-Policy restrita a `'self'` (bloqueia scripts e conexões externas).
- [x] `referrer` desativado; sem cookies.
- [x] Proteção opcional por Face ID/Touch ID/código (WebAuthn), rebloqueio após 1 min em segundo plano.
- [x] Desativar a proteção e apagar tudo exigem confirmação do dono.
- [x] Dados protegidos pela criptografia do iPhone quando o aparelho está bloqueado.
- [ ] **Limite conhecido:** a trava do portal protege o acesso às telas; os dados no navegador não têm
  criptografia própria além da do aparelho. Planejado: criptografia com chave derivada da chave de acesso (WebAuthn PRF).
- [ ] Backup com senha — planejado.

**Terceiros:** sem anúncios, sem analytics, sem rastreamento, sem fontes ou scripts externos.
A hospedagem (GitHub/Netlify) registra acessos ao site como qualquer servidor web, mas **nunca recebe os
tickets**.

**LGPD**
- [x] Política de privacidade no portal e na primeira abertura.
- [x] Finalidade única e coleta mínima.
- [x] Acesso, correção (com histórico), portabilidade (zip/CSV) e eliminação (um ou todos).
- [x] Indicação clara de onde os dados ficam (Ajustes › Onde meus dados ficam).
- [x] Qualquer recurso futuro que envie dados será opcional, desligado por padrão e com consentimento.

**Integridade**
- [x] Foto original preservada (Blob intacto); texto do OCR imutável; correções no histórico.
- [x] Horários impressos nunca alterados automaticamente; avisos de que não substitui o ponto oficial.
- [x] Duplicidades nunca excluídas automaticamente; exclusões sempre com confirmação.
