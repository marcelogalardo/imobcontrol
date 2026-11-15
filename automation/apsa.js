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

function extrairLancamentosDetalhes(documento) {
  const pagina = documento.pages[0];

  const itens = [...pagina.content]
    .filter(item => item.str?.trim());

  const cabecalho = itens.find(item =>
    normalizarTexto(item.str).includes('DETALHES DO RECIBO')
  );

  const proximaSecao = itens.find(item =>
    normalizarTexto(item.str).includes('POSICAO FINANCEIRA')
  );

  if (!cabecalho) {
    throw new Error(
      'A seção DETALHES DO RECIBO não foi encontrada.'
    );
  }

  if (!proximaSecao) {
    throw new Error(
      'A seção POSIÇÃO FINANCEIRA não foi encontrada.'
    );
  }

  console.log(
    `Recortando Detalhes do Recibo entre Y=${cabecalho.y} e Y=${proximaSecao.y}`
  );

const itensDetalhes = itens
  .filter(item =>
    item.y > cabecalho.y + 2 &&
    item.y < proximaSecao.y - 2
  )
  .sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) {
      return a.y - b.y;
    }

    return a.x - b.x;
  });

  const linhas = [];

  for (const item of itensDetalhes) {
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

  const linhasTexto = linhas
    .sort((a, b) => a.y - b.y)
    .map(linha =>
      linha.itens
        .sort((a, b) => a.x - b.x)
        .map(item => item.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  const lancamentos = [];

  for (const linha of linhasTexto) {
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

  return {
    linhas: linhasTexto,
    lancamentos
  };
}

function extrairTotalBoleto(documento) {
  const pagina = documento.pages[0];

  const itens = [...pagina.content]
    .filter(item => item.str?.trim());

  const converterValorDoItem = item => {
    const resultado = String(item.str).match(
      /R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/
    );

    return resultado
      ? moedaParaNumero(resultado[1])
      : null;
  };

  const rotulosPrioritarios = itens.filter(item => {
    const texto = normalizarTexto(item.str);

    return (
      texto.includes('VALOR DO DOCUMENTO') ||
      texto === 'VALOR'
    );
  });

  for (const rotulo of rotulosPrioritarios) {
    const candidatos = itens
      .map(item => ({
        item,
        valor: converterValorDoItem(item)
      }))
      .filter(candidato =>
        candidato.valor !== null &&
        Math.abs(candidato.item.y - rotulo.y) <= 15
      )
      .sort((a, b) => {
        const distanciaA =
          Math.abs(a.item.y - rotulo.y) +
          Math.abs(a.item.x - rotulo.x);

        const distanciaB =
          Math.abs(b.item.y - rotulo.y) +
          Math.abs(b.item.x - rotulo.x);

        return distanciaA - distanciaB;
      });

    if (candidatos.length) {
      console.log(
        `Total localizado próximo de "${rotulo.str}": ${candidatos[0].valor}`
      );

      return candidatos[0].valor;
    }
  }

  /*
   * Alternativa: procura valores escritos explicitamente com R$.
   * O total do boleto da APSA aparece dessa forma no cabeçalho.
   */
  const valoresComCifrao = itens
    .map(item => {
      const resultado = String(item.str).match(
        /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/
      );

      return resultado
        ? moedaParaNumero(resultado[1])
        : null;
    })
    .filter(valor => valor !== null);

  if (valoresComCifrao.length) {
    console.log(
      `Total localizado pelo símbolo R$: ${valoresComCifrao[0]}`
    );

    return valoresComCifrao[0];
  }

  throw new Error(
    'Não foi possível identificar o total do boleto.'
  );
}

function arredondar(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}





async function analisarBoleto(pdfBuffer) {
  const extrator = new PDFExtract();

  const documento = await extrator.extractBuffer(pdfBuffer, {
    normalizeWhitespace: true
  });

  const detalhes = extrairLancamentosDetalhes(documento);
  const lancamentos = detalhes.lancamentos;

  const totalBoleto = arredondar(
    extrairTotalBoleto(documento)
  );

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

  const totalLancamentos = arredondar(
    lancamentos.reduce(
      (soma, item) => soma + item.valor,
      0
    )
  );

  const diferenca = arredondar(
    totalBoleto - totalLancamentos
  );

  const valoresConferem =
    Math.abs(diferenca) <= 0.01;

  const possuiItensParaRevisar =
    lancamentos.some(
      item => item.responsavel === 'revisar'
    );

  return {
    quantidade_paginas: documento.pages.length,
    quantidade_lancamentos: lancamentos.length,

    lancamentos,

    totais: {
      boleto: totalBoleto,
      lancamentos: totalLancamentos,
      inquilino: totalInquilino,
      proprietario: totalProprietario,
      revisar: totalRevisar,
      diferenca
    },

    validacao: {
      valores_conferem: valoresConferem,
      tolerancia: 0.01,
      possui_itens_para_revisar: possuiItensParaRevisar,
      status:
        valoresConferem && !possuiItensParaRevisar
          ? 'aprovado'
          : 'revisar'
    },

    linhas_detalhes_recibo: detalhes.linhas
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

const formatarMoeda = valor =>
  valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

console.log(
  `Total do boleto: ${formatarMoeda(analise.totais.boleto)}`
);

console.log(
  `Total dos lançamentos: ${formatarMoeda(
    analise.totais.lancamentos
  )}`
);

console.log(
  `Inquilino: ${formatarMoeda(analise.totais.inquilino)}`
);

console.log(
  `Proprietário: ${formatarMoeda(
    analise.totais.proprietario
  )}`
);

console.log(
  `Revisar: ${formatarMoeda(analise.totais.revisar)}`
);

console.log(
  `Diferença: ${formatarMoeda(analise.totais.diferenca)}`
);

console.log(
  `Conferência: ${
    analise.validacao.valores_conferem
      ? 'VALORES CONFEREM'
      : 'VALORES NÃO CONFEREM'
  }`
);

console.log(
  `Status final: ${analise.validacao.status.toUpperCase()}`
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
