import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const sample = (name: string) => resolve(import.meta.dirname, '../../docs/amostras', name);
const shots = resolve(import.meta.dirname, '../../docs/telas');

async function importAndRead(page: Page, file: string) {
  await page.getByTestId('files-input').setInputFiles(sample(file));
  await expect(page.getByRole('button', { name: 'Reconhecer texto' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconhecer texto' }).click();
  // OCR roda no navegador (Tesseract em WebAssembly).
  await expect(page.getByRole('button', { name: /e confirmar/ })).toBeVisible({ timeout: 120_000 });
}

test('fluxo completo do portal', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await test.step('primeira abertura: apresentação de privacidade', async () => {
    await page.goto('./');
    await expect(page.getByRole('dialog', { name: 'Bem-vindo ao Meu Ponto Digital' })).toBeVisible();
    await page.screenshot({ path: `${shots}/00-boas-vindas.png` });
    await page.getByRole('button', { name: 'Começar' }).click();
    await expect(page.getByRole('heading', { name: 'Meu Ponto Digital' })).toBeVisible();
    await expect(page.getByText('Nenhum ticket ainda.')).toBeVisible();
  });

  await test.step('ticket nítido: OCR, revisão e confirmação', async () => {
    await page.getByTestId('files-input').setInputFiles(sample('01-nitido-portaria671-entrada.jpg'));
    await expect(page.getByRole('button', { name: 'Reconhecer texto' })).toBeVisible();
    await page.screenshot({ path: `${shots}/01-editor.png` });
    await page.getByRole('button', { name: 'Reconhecer texto' }).click();
    await expect(page.getByRole('button', { name: /e confirmar/ })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByLabel('Data')).toHaveValue('2026-10-22');
    await expect(page.getByLabel('Horário')).toHaveValue('08:01');
    await expect(page.getByLabel('Tipo')).toHaveValue('entrada');
    await expect(page.getByLabel('CNPJ')).toHaveValue('11.222.333/0001-81');
    await expect(page.getByLabel('Nº do ticket / NSR')).toHaveValue('000012345');
    await page.screenshot({ path: `${shots}/02-revisao.png`, fullPage: true });
    await page.getByRole('button', { name: 'Salvar e confirmar' }).click();
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  });

  await test.step('ticket sem tipo impresso: confirmação obrigatória', async () => {
    await importAndRead(page, '02-inclinado-portaria1510-sem-tipo.jpg');
    await expect(page.getByRole('button', { name: 'Salvar e confirmar' })).toBeDisabled();
    await expect(page.getByText('Escolha o tipo de marcação.')).toBeVisible();
    await page.screenshot({ path: `${shots}/03-revisao-pendente.png`, fullPage: true });
    await page.getByLabel('Tipo').selectOption('inicioIntervalo');
    // A data lida (22/10/20 → 2020) foi marcada como duvidosa: o usuário corrige.
    await page.getByLabel('Data').fill('2026-10-22');
    await expect(page.getByLabel('Horário')).toHaveValue('12:03');
    // Campos certos, mas com confiança média: o usuário confere explicitamente.
    for (const button of await page.getByRole('button', { name: 'Está correto' }).all()) {
      if (await button.isEnabled()) await button.click();
    }
    await expect(page.getByRole('button', { name: 'Salvar e confirmar' })).toBeEnabled();
    await page.getByRole('button', { name: 'Salvar e confirmar' }).click();
    await expect(page.getByText('tickets arquivados')).toBeVisible();
  });

  await test.step('foto tremida: aviso antes da leitura e opção de fotografar de novo', async () => {
    await page.getByTestId('files-input').setInputFiles(resolve(import.meta.dirname, 'fixtures/tremida.jpg'));
    await expect(page.getByText('Esta foto provavelmente não vai ser lida bem')).toBeVisible();
    await expect(page.getByText(/tremida ou fora de foco/)).toBeVisible();
    await page.screenshot({ path: `${shots}/12-foto-tremida.png` });
    // O seletor abre no mesmo toque (exigência do Safari no iPhone).
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Escolher outra foto' }).click()]);
    await chooser.setFiles([]);
    await expect(page.getByRole('button', { name: 'Reconhecer texto' })).toHaveCount(0);
  });

  await test.step('valor conhecido: empresa lida com erro é corrigida pelos tickets confirmados', async () => {
    await importAndRead(page, '../../tests/e2e/fixtures/empresa-com-erro.jpg');
    await expect(page.getByText('Ajustes com base nos seus tickets confirmados')).toBeVisible();
    await expect(page.getByText(/“PADARIA BOM DIA LTOA” corrigido para “PADARIA BOM DIA LTDA”/)).toBeVisible();
    await expect(page.getByLabel('Empresa')).toHaveValue('PADARIA BOM DIA LTDA');
    await page.screenshot({ path: `${shots}/13-ajuste-automatico.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await page.getByRole('button', { name: 'Descartar e sair' }).click();
  });

  await test.step('foto repetida: alerta de duplicidade, nada apagado', async () => {
    await importAndRead(page, '04-foto-repetida-do-01.jpg');
    await page.getByRole('button', { name: 'Salvar e confirmar' }).click();
    await expect(page.getByRole('dialog', { name: 'Possível duplicidade' })).toBeVisible();
    await page.screenshot({ path: `${shots}/04-duplicidade.png` });
    await page.getByRole('dialog', { name: 'Possível duplicidade' }).getByRole('button', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await page.getByRole('button', { name: 'Descartar e sair' }).click();
    await expect(page.getByText('tickets arquivados')).toBeVisible();
  });

  await test.step('tela inicial', async () => {
    await page.screenshot({ path: `${shots}/05-inicio.png` });
    await expect(page.locator('.stat b').first()).toHaveText('2');
  });

  await test.step('busca por horário, data e texto', async () => {
    await page.getByRole('link', { name: 'Arquivo' }).click();
    const search = page.getByLabel('Buscar no arquivo');
    const cases: [string, number][] = [['8h01', 1], ['8:01', 1], ['12:03', 1], ['22/10', 2], ['22/10/26', 2], ['outubro', 2],
      ['quinta-feira', 2], ['padaria', 1], ['alfa', 1], ['000012345', 1], ['maria oliveira', 1], ['inexistente', 0]];
    for (const [q, n] of cases) {
      await search.fill(q);
      await expect(page.locator('.ticket-row'), `busca "${q}"`).toHaveCount(n);
    }
    await search.fill('');
    await page.screenshot({ path: `${shots}/06-arquivo.png` });
  });

  await test.step('dados continuam após recarregar', async () => {
    await page.reload();
    await expect(page.locator('.ticket-row')).toHaveCount(2);
  });

  await test.step('edição registra histórico e preserva o OCR', async () => {
    await page.getByLabel('Buscar no arquivo').fill('08:01');
    await page.locator('.ticket-row').first().click();
    const ocr = await page.locator('.ocr-text').textContent();
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Horário').fill('08:07');
    await page.getByRole('button', { name: 'Salvar e confirmar' }).click();
    await expect(page.getByText('08:01 → 08:07')).toBeVisible();
    expect(await page.locator('.ocr-text').textContent()).toBe(ocr);
    await page.screenshot({ path: `${shots}/07-detalhe.png`, fullPage: true });
  });

  await test.step('calendário e dia', async () => {
    await page.getByRole('link', { name: 'Calendário' }).click();
    await page.screenshot({ path: `${shots}/08-calendario.png` });
    await page.getByRole('link', { name: /^22 de outubro, 2 ticket/ }).click();
    await expect(page.getByText('Resumo da jornada')).toBeVisible();
    await expect(page.getByText('+3h56')).toBeVisible(); // 08:07 → 12:03
    await page.screenshot({ path: `${shots}/09-dia.png`, fullPage: true });
  });

  await test.step('backup, apagar tudo e restaurar sem perda', async () => {
    await page.goto('./#/ajustes/backup');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Fazer backup agora' }).click()]);
    const zip = resolve(import.meta.dirname, '../../test-results/backup.zip');
    await download.saveAs(zip);
    await expect(page.getByText(/Backup gerado/)).toBeVisible();
    await page.screenshot({ path: `${shots}/10-backup.png` });

    await page.goto('./#/ajustes');
    await page.getByRole('button', { name: 'Apagar todos os dados' }).click();
    await page.getByRole('button', { name: 'Apagar tudo deste aparelho' }).click();
    await expect(page.getByText('Todos os tickets foram apagados deste aparelho.')).toBeVisible();

    await page.goto('./#/ajustes/backup');
    await page.getByTestId('restore-input').setInputFiles(zip);
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText('2 ticket(s) restaurado(s).')).toBeVisible();
    await page.getByTestId('restore-input').setInputFiles(zip);
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText('0 ticket(s) restaurado(s). 2 já existiam')).toBeVisible();

    await page.goto('./#/arquivo');
    await page.getByLabel('Buscar no arquivo').fill('');
    await expect(page.locator('.ticket-row')).toHaveCount(2);
    await page.locator('.ticket-row').first().click();
    await expect(page.locator('.photo img')).toBeVisible();
  });

  await test.step('arquivo que não é backup é recusado sem alterar nada', async () => {
    await page.goto('./#/ajustes/backup');
    await page.getByTestId('restore-input').setInputFiles(sample('01-nitido-portaria671-entrada.jpg'));
    await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText(/não é um backup/)).toBeVisible();
  });

  await test.step('funciona sem internet (inclusive o OCR)', async () => {
    await page.goto('./');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 30_000 }).catch(() => {});
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('tickets arquivados')).toBeVisible();
    await importAndRead(page, '06-nitido-saida-mesmo-dia.jpg');
    await expect(page.getByLabel('Tipo')).toHaveValue('saida');
    await page.getByRole('button', { name: 'Salvar e confirmar' }).click();
    await expect(page.locator('.stat b').first()).toHaveText('3');
    await context.setOffline(false);
  });

  await test.step('jornada', async () => {
    await page.getByRole('link', { name: 'Jornada' }).click();
    await expect(page.getByText('Resumo do mês')).toBeVisible();
    await page.screenshot({ path: `${shots}/11-jornada.png`, fullPage: true });
  });

  expect(errors.filter((e) => !/favicon|Failed to load resource/.test(e))).toEqual([]);
});
