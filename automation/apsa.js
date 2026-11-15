import { chromium } from 'playwright';
import { PDFExtract } from 'pdf.js-extract';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';


const APSA_URL = 'https://areadocliente.apsa.com.br/';

const usuario = process.env.APSA_USER;
const senha = process.env.APSA_PASSWORD;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  console.error(
    'SUPABASE_URL ou SUPABASE_SECRET_KEY não configurados.'
  );
  process.exit(1);
}

const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);

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

  /*
   * Mantém a ordem original dos objetos de texto do PDF.
   * Não agrupa elementos da esquerda com elementos da direita.
   */
  const textoCompleto = pagina.content
    .map(item => String(item.str || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const textoNormalizado = normalizarTexto(textoCompleto);
  const marcadorInicio = 'DETALHES DO RECIBO';
  const marcadorFim = 'POSICAO FINANCEIRA';

  const inicio = textoNormalizado.indexOf(marcadorInicio);
  const fim = textoNormalizado.indexOf(
    marcadorFim,
    inicio + marcadorInicio.length
  );

  if (inicio === -1) {
    throw new Error(
      'A seção DETALHES DO RECIBO não foi encontrada.'
    );
  }

  if (fim === -1) {
    throw new Error(
      'A seção POSIÇÃO FINANCEIRA não foi encontrada.'
    );
  }

  /*
   * Recorta o texto original usando as mesmas posições.
   * O resultado contém somente o que existe entre os dois títulos.
   */
  const trechoDetalhes = textoCompleto
    .slice(
      inicio + marcadorInicio.length,
      fim
    )
    .replace(/\s+/g, ' ')
    .trim();

  console.log('Trecho exclusivo de Detalhes do Recibo:');
  console.log(trechoDetalhes);

  const lancamentos = [];

  /*
   * Cada lançamento termina com um valor monetário.
   * O próximo lançamento começa logo após esse valor.
   */
  const padraoLancamento =
    /(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?=\s+|$)/g;

  let correspondencia;

  while (
    (correspondencia = padraoLancamento.exec(trechoDetalhes)) !== null
  ) {
    const descricao = correspondencia[1]
      .replace(/\s+/g, ' ')
      .trim();

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

  console.log(
    `Lançamentos extraídos exclusivamente do recibo: ${lancamentos.length}`
  );

  return {
    linhas: [trechoDetalhes],
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

async function gravarFaturaNoSupabase(pdfBuffer, analise) {
  console.log('Localizando despesa APSA no Supabase...');

  const { data: despesas, error: erroDespesas } =
    await supabaseAdmin
      .from('property_expenses')
      .select(`
        id,
        owner_id,
        label,
        providers!inner(name)
      `)
      .eq('active', true)
      .ilike('providers.name', '%APSA%');

  if (erroDespesas) {
    throw new Error(
      `Erro ao localizar despesa APSA: ${erroDespesas.message}`
    );
  }

  if (!despesas || despesas.length === 0) {
    throw new Error(
      'Nenhuma despesa ativa vinculada ao fornecedor APSA foi encontrada.'
    );
  }

  if (despesas.length > 1) {
    throw new Error(
      `Foram encontradas ${despesas.length} despesas APSA ativas. ` +
      'É necessário identificar a conta/unidade antes de gravar.'
    );
  }

  const despesa = despesas[0];

  console.log(`Despesa localizada: ${despesa.label}`);

  /*
   * O hash identifica unicamente o conteúdo do PDF.
   * Se o mesmo boleto aparecer novamente, não será duplicado.
   */
  const hashPdf = createHash('sha256')
    .update(pdfBuffer)
    .digest('hex');

  const identificador = hashPdf.slice(0, 16);
  const numeroFatura = `APSA-${identificador}`;
  const nomeArquivo = `${numeroFatura}.pdf`;

  const storagePath =
    `${despesa.owner_id}/apsa/${nomeArquivo}`;

  console.log(`Identificador do boleto: ${numeroFatura}`);

  const { data: faturaExistente, error: erroConsulta } =
    await supabaseAdmin
      .from('invoices')
      .select('id, invoice_number, storage_path')
      .eq('storage_path', storagePath)
      .maybeSingle();

  if (erroConsulta) {
    throw new Error(
      `Erro ao consultar duplicidade: ${erroConsulta.message}`
    );
  }

  if (faturaExistente) {
    console.log(
      `Boleto já registrado: ${faturaExistente.invoice_number}`
    );

    return {
      duplicado: true,
      invoice_id: faturaExistente.id,
      storage_path: faturaExistente.storage_path
    };
  }

  console.log('Enviando PDF para o Supabase Storage...');

  const { data: arquivo, error: erroUpload } =
    await supabaseAdmin.storage
      .from('invoices')
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false
      });

  if (erroUpload) {
    throw new Error(
      `Erro ao enviar PDF ao Storage: ${erroUpload.message}`
    );
  }

  console.log(`PDF enviado: ${arquivo.path}`);

  const status =
    analise.validacao.status === 'aprovado'
      ? 'approved'
      : 'needs_review';

  const extractedData = {
    source: 'apsa',
    parser_version: '1.0.0',
    pdf_sha256: hashPdf,

    lancamentos: analise.lancamentos,

    totals: {
      boleto: analise.totais.boleto,
      lancamentos: analise.totais.lancamentos,
      inquilino: analise.totais.inquilino,
      proprietario: analise.totais.proprietario,
      revisar: analise.totais.revisar,
      diferenca: analise.totais.diferenca
    },

    validation: analise.validacao,

    tenant_amount: analise.totais.inquilino,
    owner_amount: analise.totais.proprietario,

    imported_at: new Date().toISOString()
  };

const itemCondominio = analise.lancamentos.find(
  item => item.descricao_normalizada.includes('CONDOMINIO')
);

if (!itemCondominio) {
  throw new Error(
    'Não foi possível identificar a referência do condomínio.'
  );
}

const referencia = itemCondominio.descricao.match(
  /(\d{2})\/(\d{4})/
);

if (!referencia) {
  throw new Error(
    `Não foi possível extrair mês/ano de: ${itemCondominio.descricao}`
  );
}

const [, mesReferencia, anoReferencia] = referencia;

/*
 * reference_month é uma coluna date.
 * Usamos o primeiro dia do mês como referência.
 */
const referenceMonth =
  `${anoReferencia}-${mesReferencia}-01`;

console.log(
  `Mês de referência identificado: ${referenceMonth}`
);
  
  console.log('Criando registro na tabela invoices...');

  const { data: novaFatura, error: erroInsert } =
    await supabaseAdmin
      .from('invoices')
      .insert({
        owner_id: despesa.owner_id,
        property_expense_id: despesa.id,
        reference_month: referenceMonth,
        invoice_number: numeroFatura,        
        amount: analise.totais.boleto,
        status,
        storage_path: arquivo.path,
        original_filename: nomeArquivo,
        source_url: APSA_URL,
        extracted_data: extractedData
      })
      .select('id, invoice_number, amount, status, storage_path')
      .single();

  if (erroInsert) {
    /*
     * Se o banco falhar depois do upload, exclui o arquivo
     * para não deixar PDF órfão no Storage.
     */
    await supabaseAdmin.storage
      .from('invoices')
      .remove([arquivo.path]);

    throw new Error(
      `Erro ao criar fatura: ${erroInsert.message}`
    );
  }

  console.log('Fatura criada no Supabase.');
  console.log(`Invoice ID: ${novaFatura.id}`);
  console.log(`Número: ${novaFatura.invoice_number}`);
  console.log(`Status: ${novaFatura.status}`);
  console.log(
    `Total: ${novaFatura.amount.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    })}`
  );

  console.log(
    `Inquilino: ${analise.totais.inquilino.toLocaleString(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    )}`
  );

  console.log(
    `Proprietário: ${analise.totais.proprietario.toLocaleString(
      'pt-BR',
      {
        style: 'currency',
        currency: 'BRL'
      }
    )}`
  );

  return {
    duplicado: false,
    invoice_id: novaFatura.id,
    storage_path: novaFatura.storage_path
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

console.log('Abrindo menu Minha Unidade...');

const minhaUnidade = page.getByRole('link', {
  name: /MINHA UNIDADE/i
});

await minhaUnidade.waitFor({
  state: 'visible',
  timeout: 30000
});

await minhaUnidade.click();
await page.waitForTimeout(1000);

console.log('Abrindo Financeiro da unidade...');

const financeiro = page.getByRole('link', {
  name: /Financeiro da unidade/i
});

await financeiro.waitFor({
  state: 'visible',
  timeout: 15000
});

await financeiro.click();
await page.waitForTimeout(1000);

console.log('Abrindo 2ª via de boleto...');

const segundaVia = page.getByRole('link', {
  name: /2ª via de boleto/i
});

await segundaVia.waitFor({
  state: 'visible',
  timeout: 30000
});

await segundaVia.click();

await page.waitForLoadState('domcontentloaded');

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

console.log('Gravando fatura APSA no Supabase...');

const resultadoSupabase =
  await gravarFaturaNoSupabase(pdfBuffer, analise);

if (resultadoSupabase.duplicado) {
  console.log(
    'Nenhuma nova fatura foi criada porque o boleto já existia.'
  );
} else {
  console.log(
    'Boleto APSA integrado ao ImobControl com sucesso.'
  );
}
  
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
