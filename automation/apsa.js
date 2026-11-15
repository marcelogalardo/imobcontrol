import { chromium } from 'playwright';

const APSA_URL = 'https://areadocliente.apsa.com.br/';

const usuario = process.env.APSA_USER;
const senha = process.env.APSA_PASSWORD;

if (!usuario || !senha) {
  console.error('APSA_USER ou APSA_PASSWORD não configurados.');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true
});

const context = await browser.newContext({
  acceptDownloads: true,
  locale: 'pt-BR'
});

const page = await context.newPage();

try {
  console.log('Abrindo portal APSA...');

  await page.goto(APSA_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page
    .locator('#ucLoginSistema_tbNomeEntrar')
    .fill(usuario);

  await page
    .locator('#ucLoginSistema_tbSenhaEntrar')
    .fill(senha);

  console.log('Efetuando login...');

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#ucLoginSistema_btEntrar').click()
  ]);

  await page.waitForTimeout(2000);

  if (await page.locator('#ucLoginSistema_tbNomeEntrar').isVisible()) {
    throw new Error(
      'O portal permaneceu na tela de login. Verifique usuário e senha.'
    );
  }

  console.log('Login realizado.');

  const minhaUnidade = page.getByRole('link', {
    name: /MINHA UNIDADE/i
  });

  if (await minhaUnidade.isVisible()) {
    await minhaUnidade.click();
    await page.waitForTimeout(500);
  }

  const financeiro = page.getByRole('link', {
    name: /Financeiro da unidade/i
  });

  if (await financeiro.isVisible()) {
    await financeiro.click();
    await page.waitForTimeout(500);
  }

  const segundaVia = page.getByRole('link', {
    name: /2ª via de boleto/i
  });

  await segundaVia.waitFor({
    state: 'visible',
    timeout: 15000
  });

  console.log('Abrindo 2ª via de boleto...');

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    segundaVia.click()
  ]);

  await page.waitForTimeout(2000);

  const boletos = page.locator(
    'a[id^="ctl00_ContentBody_ucBoletoLista_rpListaBoleto_"][id$="_lkSeleciona"]'
  );

  const quantidade = await boletos.count();

  console.log(`Boletos encontrados: ${quantidade}`);
  console.log(`Página atual: ${page.url()}`);

if (quantidade === 0) {
  console.log('Nenhum boleto disponível no portal.');
} else {
  console.log('Página de boletos acessada com sucesso.');
  console.log('Abrindo boleto...');


const boleto = boletos.first();

console.log('Monitorando resposta do boleto...');

const pdfPromise = page.waitForResponse(
  response => {
    const contentType = response.headers()['content-type'] || '';

    return (
      contentType.includes('application/pdf') ||
      response.url().toLowerCase().includes('.pdf')
    );
  },
  { timeout: 15000 }
).catch(() => null);

await boleto.click();

const pdfResponse = await pdfPromise;

if (pdfResponse) {
  console.log('PDF detectado.');

  const pdfBuffer = await pdfResponse.body();

  const fs = await import('node:fs/promises');

  await fs.writeFile(
    './boleto-apsa.pdf',
    pdfBuffer
  );

  console.log('Boleto salvo com sucesso.');
  console.log('Arquivo: boleto-apsa.pdf');
} else {
  console.log('A resposta PDF não foi detectada.');

  await page.waitForTimeout(3000);

  console.log(`Página atual: ${page.url()}`);
}

console.log('Teste do boleto concluído.');

  

}
} catch (error) {
  console.error('Falha na automação APSA:');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
