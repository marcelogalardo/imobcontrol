import { chromium } from 'playwright';
import { PDFExtract } from 'pdf.js-extract';

const APSA_URL = 'https://areadocliente.apsa.com.br/';

const usuario = process.env.APSA_USER;
const senha = process.env.APSA_PASSWORD;

if (!usuario || !senha) {
  console.error('APSA_USER ou APSA_PASSWORD não configurados.');
  process.exit(1);
}

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function moedaParaNumero(valor) {
  return Number(
    String(valor)
      .replace(/\./g, '')
      .replace(',', '.')
  );
}

function classificarLancamento(descricao) {
  const texto = normalizarTexto(descricao);

  const regrasProprietario = [
    'COTA EXTRA',
    'FUNDO RESERVA',
    'FUNDO DE RESERVA',
    'MULTA',
    'JUROS'
  ];

  const regrasInquilino = [
    'AGUA/ESGOTO',
    'AGUA ESGOTO',
    '13O SALARIO',
    '13 SALARIO',
    'CONDOMINIO'
  ];

  if (regrasProprietario.some(termo => texto.includes(termo))) {
    return 'proprietario';
  }

  if (regrasInquilino.some(termo => texto.includes(termo))) {
    return 'inquilino';
  }

  return 'revisar';
}

function agruparLinhasDaPagina(pagina) {
  const itens = [...pagina.content]
    .filter(item => item.str?.trim())
    .sort((a, b) => {
      const diferencaY = a.y - b.y;

      if (Math.abs(diferencaY) > 2) {
        return diferencaY;
      }

      return a.x - b.x;
    });

  const linhas = [];

  for (const item of itens) {
    let linha = linhas.find(
      existente => Math.abs(existente.y - item.y) <= 2
    );

    if (!linha) {
      linha = {
        y: item.y,
        itens: []
      };

      linhas.push(linha);
    }

    linha.itens.push(item);
  }

  return linhas
    .sort((a, b) => a.y - b.y)
    .map(linha => {
      const texto = linha.itens
        .sort((a, b) => a.x - b.x)
        .map(item => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      return texto;
    })
    .filter(Boolean);
}

function extrairLancamentos(linhas) {
  const inicio = linhas.findIndex(linha =>
    normalizarTexto(linha).includes('DETALHES DO RECIBO')
  );

  const linhasParaAnalisar =
    inicio >= 0 ? linhas.slice(inicio + 1) : linhas;

  const lancamentos = [];

  for (const linha of linhasParaAnalisar) {
    const normalizada = normalizarTexto(linha);

    if (
      normalizada.includes('TOTAL DO RECIBO') ||
      normalizada.includes('VALOR DO DOCUMENTO') ||
      normalizada.includes('PAGADOR') ||
      normalizada.includes('BENEFICIARIO')
    ) {
      continue;
    }

    const correspondencia = linha.match(
      /^(.*?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/
    );

    if (!correspondencia) {
      continue;
    }

    const descricao = correspondencia[1].trim();
    const valorTexto = correspondencia[2];

    if (!descricao || descricao.length < 3) {
      continue;
    }

    lancamentos.push({
      descricao,
      descricao_normalizada: normalizarTexto(descricao),
      valor: moedaParaNumero(valorTexto),
      responsavel: classificarLancamento(descricao)
    });
  }

  return lancamentos;
}

function arredondar(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

async function analisarBoleto(pdfBuffer) {
  const extrator = new PDFExtract();

  const documento = await extrator.extractBuffer(pdfBuffer, {
    normalizeWhitespace: true
  });

  const linhas = documento.pages.flatMap(agruparLinhasDaPagina);
  const lancamentos = extrairLancamentos(linhas);

  const totalInquilino = arredondar(
    lancamentos
      .filter(item => item.responsavel === 'inquilino')
      .reduce((soma, item) => soma + item.valor, 0)
  );

  const totalProprietario = arredondar(
    lancamentos
      .filter(item => item.responsavel === 'proprietario')
      .reduce((soma, item) => soma + item.valor, 0)
  );

  const totalRevisar = arredondar(
    lancamentos
      .filter(item => item.responsavel === 'revisar')
      .reduce((soma, item) => soma + item.valor, 0)
  );

  const totalClassificado = arredondar(
    totalInquilino + totalProprietario + totalRevisar
  );

  return {
    quantidade_paginas: documento.pages.length,
    quantidade_lancamentos: lancamentos.length,
    lancamentos,
    totais: {
      inquilino: totalInquilino,
      proprietario: totalProprietario,
      revisar: totalRevisar,
      classificado: totalClassificado
    },
    linhas_extraidas: linhas
  };
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

    return contentType.toLowerCase().includes('application/pdf');  

    
  },
  { timeout: 15000 }
).catch(() => null);

await boleto.click();

const pdfResponse = await pdfPromise;

if (pdfResponse) {
  console.log('PDF detectado.');

  const pdfBuffer = await pdfResponse.body();

  console.log(`Tamanho recebido: ${pdfBuffer.length} bytes`);
  console.log(`Assinatura: ${pdfBuffer.subarray(0, 5).toString()}`);

  if (pdfBuffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('A resposta capturada não é um PDF válido.');
  }

  const fs = await import('node:fs/promises');

  await fs.writeFile('./boleto-apsa.pdf', pdfBuffer);

  console.log('Boleto salvo com sucesso.');
  console.log('Arquivo: boleto-apsa.pdf');

console.log('Lendo lançamentos do boleto...');

const analise = await analisarBoleto(pdfBuffer);

console.log(
  `Lançamentos identificados: ${analise.quantidade_lancamentos}`
);

for (const item of analise.lancamentos) {
  const valorFormatado = item.valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  console.log(
    `[${item.responsavel.toUpperCase()}] ${item.descricao} = ${valorFormatado}`
  );
}

console.log('Resumo da divisão:');

console.log(
  `Inquilino: ${analise.totais.inquilino.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })}`
);

console.log(
  `Proprietário: ${analise.totais.proprietario.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })}`
);

console.log(
  `Revisar: ${analise.totais.revisar.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })}`
);

console.log(
  `Total classificado: ${analise.totais.classificado.toLocaleString(
    'pt-BR',
    {
      style: 'currency',
      currency: 'BRL'
    }
  )}`
);

await fs.writeFile(
  './resumo-apsa.json',
  JSON.stringify(analise, null, 2),
  'utf8'
);

console.log('Resumo salvo em resumo-apsa.json');
  
} else {
  console.log('A resposta PDF não foi detectada.');
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
