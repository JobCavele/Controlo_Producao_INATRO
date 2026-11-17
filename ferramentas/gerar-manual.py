#!/usr/bin/env python3
"""
Gera o manual do utilizador em PDF e Word a partir de uma só fonte de texto.

    python3 ferramentas/gerar-manual.py

Escreve assets/manual/manual-do-utilizador.pdf e .docx. Precisa de reportlab e
python-docx (só para gerar o manual; a aplicação não usa nenhum dos dois).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'app'
OUT = ROOT / 'assets' / 'manual'
VERSION = '2.0.0'
DATA = '11/2026'

GREEN = '#0b3d1f'
GREEN_MID = '#0e7a2e'
INK = '#16241b'
MUTED = '#5b6b5f'
LINE = '#e4eae2'
TINT = '#eaf4ec'
AMBER = '#a46a12'
AMBER_TINT = '#fdf3e2'
RED = '#b4362d'
RED_TINT = '#fbeceb'

# --------------------------------------------------------------------------- texto ---
# Blocos: ('h1', …), ('h2', …), ('p', …), ('bullet', […]), ('steps', […]),
# ('table', cabeçalho, linhas, larguras), ('note', título, texto), ('pagebreak',)

CONTENT: list[tuple] = [
    ('h1', '1. Para que serve o Conta Carta'),
    ('p', 'O Conta Carta é o registo de produção de cartas de condução no INATRO, IP. Acompanha a carta '
          'desde o cartão em branco até à entrega na delegação: produção e rejeições das duas máquinas, '
          'motivos de rejeição do INCAPE, lotes de personalização e impressão, controle de qualidade, '
          'despacho e o material do armazém.'),
    ('p', 'Escreve-se pouco e o programa calcula o resto. As aprovadas nunca se escrevem à mão: são as '
          'produzidas menos as cartas que chumbaram no teste de qualidade.'),
    ('h2', 'Os destinos de cada carta'),
    ('table', ['Destino', 'O que é', 'Como entra na conta'],
     [['Produzida', 'Saiu da máquina naquele dia.', 'Soma das produzidas das duas máquinas.'],
      ['Rejeitada pela máquina', 'A máquina deitou fora antes do teste.', 'Conta como produzida e como rejeição da máquina.'],
      ['Chumbada no teste', 'Passou a máquina e reprovou no controle de qualidade.', 'Conta como produzida e como rejeição no teste; leva sempre um motivo do INCAPE.'],
      ['Aprovada', 'Voltou ao lote e segue para despacho.', 'Produzidas − chumbadas no teste. As rejeitadas que o teste não chumbar voltam a contar.'],
     ], [0.28, 0.34, 0.38]),
    ('note', 'O exemplo da sala',
     'Num dia de 500 cartas, a máquina rejeita 10 e o teste chumba 5. Ficam 495 aprovadas. Se o teste não '
     'chumbar nenhuma das 10 rejeitadas, as 500 contam como aprovadas e as 10 vão para retrabalho.'),
    ('h2', 'As áreas do sistema'),
    ('table', ['Área', 'O que guarda'],
     [['Produção', 'Produzidas e rejeitadas por máquina, por dia, mês ou período.'],
      ['Motivos de rejeição', 'As seis razões do INCAPE, por máquina, em cada registo.'],
      ['Armazém', 'Cartões em branco e consumíveis: contratado, entregue, por entregar, dado e em armazém.'],
      ['Lotes', 'Cada lote vai de personalização a impressão, qualidade e despacho, com a data de cada fase.'],
      ['Relatórios', 'PDF e CSV de produção, rejeição, motivos, lotes, armazém e comparação de períodos.'],
     ], [0.28, 0.72]),

    ('h1', '2. Antes de começar: instalar e abrir'),
    ('p', 'Precisas de Python 3.9 ou superior. O Conta Carta não instala pacotes, não pede conta e não fala '
          'com a internet.'),
    ('steps', ['Abra uma janela na pasta do programa.',
               'Execute python3 server.py (no Windows: duplo-clique em Iniciar_Windows.bat).',
               'Abra http://localhost:8000 no navegador e deixe a janela do servidor aberta.',
               'Porta ocupada? python3 server.py --port 8001 e abra http://localhost:8001.',
               'Outro computador da sala precisa de ver os mesmos dados: python3 server.py --host 0.0.0.0 '
               '--allow-host nome.interno.']),
    ('h2', 'Onde ficam os dados'),
    ('p', 'Os registos vivem em dados/contacarta.sqlite3, ao lado da pasta do programa. É um ficheiro SQLite '
          'com todas as gravações e um histórico de revisões. A pasta dados/ é privada desta máquina e nunca '
          'entra no repositório.'),
    ('note', 'Primeira vez',
     'Sem registos, o painel aparece vazio e o botão «Ver com dados fictícios» carrega um ano de exemplo '
     'para experimentar à vontade. O mesmo botão retira-o depois.'),

    ('h1', '3. A barra lateral e as cinco vistas'),
    ('p', 'Do lado esquerdo fica a barra verde-escura, sempre visível. Cada entrada mostra o contexto do que '
          'lá está: quantos registos, quantos materiais em alerta, quantos lotes por despachar.'),
    ('table', ['Entrada', 'Para que serve'],
     [['Painel', 'O retrato do período: indicadores, máquinas, gráfico e detalhe.'],
      ['Armazém', 'Cartões em branco e consumíveis, com o contrato e os alertas de rutura.'],
      ['Lotes', 'O trabalho em curso, fase a fase, por delegação.'],
      ['Registos', 'Tudo o que foi apontado, com edição e eliminação.'],
      ['Relatórios', 'O gerador de papel: escolher, pré-visualizar, exportar e imprimir.'],
     ], [0.25, 0.75]),
    ('p', 'No canto inferior ficam «Exportar cópia» e «Importar cópia» (.json) e o botão dos dados fictícios. '
          'Junto dos títulos aparece um ícone de informação — um toque abre a explicação daquele bloco.'),
    ('p', 'O botão «+ Novo» na barra superior abre o menu que cria o que estiver a fazer falta: registo de '
          'produção, lote ou material.'),

    ('h1', '4. Painel: o estado da produção'),
    ('h2', 'Escolher o período'),
    ('p', 'Em cima há três modos: Mês, Ano e Período (um intervalo de datas à tua escolha). Em cada modo há '
          'uma caixa só: escreve-se a data em dd/mm/aaaa (ou mm/aaaa, no mês) ou carrega-se no calendário ao '
          'lado. As setas ‹ e › andam um mês ou um ano para trás e para a frente.'),
    ('h2', 'Os cinco indicadores'),
    ('table', ['Indicador', 'O que significa', 'Como se calcula'],
     [['Produzidas', 'Cartas que as máquinas fizeram no período.', 'Soma das duas máquinas, em todos os registos.'],
      ['Aprovadas', 'Cartas boas, prontas a entregar.', 'Produzidas − chumbadas no teste. Nunca se escreve à mão.'],
      ['Rej. máquina', 'Cartas deitadas fora pela máquina.', 'Soma das rejeições da máquina, com a taxa sobre as produzidas.'],
      ['Chumbadas no teste', 'Cartas que passaram a máquina e reprovaram.', 'Soma das rejeições no teste, com a taxa e os motivos.'],
      ['Registos', 'Quantos apontamentos entram no período.', 'Linhas somadas, uma por dia, mês ou intervalo.'],
     ], [0.24, 0.36, 0.40]),
    ('p', 'No primeiro cartão aparece a variação face ao período anterior do mesmo tamanho. O gráfico mostra '
          'as barras por registo (períodos curtos) ou por mês (períodos longos), com o indicador à escolha: '
          'produzidas, rejeição da máquina ou rejeição no teste. A lupa abre o gráfico em folha cheia.'),
    ('h2', 'A barra de alertas'),
    ('p', 'Quando há algo concreto a tratar, aparece por baixo dos indicadores uma barra com os alertas: '
          'material no mínimo, material do contrato por entregar, lotes por despachar e material sem stock. '
          'Cada alerta é um botão que leva à vista certa, já filtrada.'),
    ('p', 'Se nada disto existir, a barra não aparece — o painel não enche o ecrã de avisos sem motivo.'),

    ('h1', '5. Registos: o dia de produção'),
    ('p', 'A vista Registos é o dia de hoje. Não se escreve o total do turno: aponta-se cada lote à medida '
          'que sai da máquina e o dia soma-se sozinho. O cartão de cima mostra a data, quantos lotes há, '
          'quantos estão por concluir e os números do dia — planeadas, produzidas, aprovadas, rejeitadas '
          'pela máquina e chumbadas no teste. Por baixo, a tabela tem um lote por linha.'),
    ('p', 'Ao fim de cada lote clica-se em «Adicionar lote» e regista-se a produção, as rejeições da máquina '
          'e as chumbadas no teste de qualidade daquele lote. Repete-se ao longo do dia, uma vez por lote. '
          'Cada lote pode ser concluído no momento («Concluir») ou ficar a decorrer e ser concluído mais '
          'tarde; o estado diz sempre em que ponto está.'),
    ('p', 'No fim do dia clica-se em «Terminar dia», no fundo do cartão. O dia fica fechado, com a conta '
          'consolidada, e a produção passa a contar no painel e nos relatórios sem mais nada fazer. Se for '
          'preciso corrigir, «Reabrir o dia» volta a abrir os lotes.'),
    ('h2', 'A lista dos dias'),
    ('p', 'Por baixo do dia de hoje fica a lista dos dias registados, do mais recente para o mais antigo, '
          'filtrada pelo ano escolhido em cima. Cada linha mostra os lotes, as produzidas, as aprovadas, as '
          'duas rejeições e o estado — «terminado», «a decorrer» ou «por terminar». «Ver» abre esse dia no '
          'cartão de cima e «Eliminar» apaga-o, sempre com confirmação.'),
    ('p', 'A barra superior tem o atalho «Ver o dia de hoje». Quando não há dia aberto, o cartão mostra a data '
          'de hoje já preenchida: basta acrescentar o primeiro lote.'),

    ('h1', '6. Adicionar lote: o formulário'),
    ('table', ['Campo', 'O que se escreve'],
     [['Data', 'O dia em que o lote saiu. Vem preenchida com hoje; muda-a para acabar um dia anterior.'],
      ['Lote', 'A referência do lote, por exemplo «L-2026-031». Escolher um lote do quadro preenche a delegação.'],
      ['Delegação', 'Para onde vai o lote.'],
      ['Máquina', 'Máquina 1 ou máquina 2 — cada lote sai inteiro de uma delas.'],
      ['Planeadas', 'As cartas do lote, normalmente 50. É o que se compara com o que saiu.'],
      ['Produzidas', 'As cartas que a máquina fez, incluindo as que ela rejeitou.'],
      ['Rej. máquina', 'As que a máquina deitou fora; podem passar ao teste de qualidade.'],
      ['Rej. qualidade', 'As que chumbaram no teste, já com os motivos do INCAPE.'],
     ], [0.22, 0.78]),
    ('p', 'O campo «Data» é o mesmo para todos os lotes do dia: muda-se à mão, em dd/mm/aaaa, ou pela caixa '
          'do calendário ao lado. As aprovadas nunca se escrevem: aparecem na caixa verde em baixo, a '
          'actualizar enquanto se escreve, com o número de cartas que voltaram ao lote (retrabalho).'),
    ('h2', 'Lotes a meio'),
    ('p', 'Um lote que ainda está a sair da máquina grava-se com as cartas que já tem e fica «em curso». '
          'Volta-se a ele pela linha do dia, em «Editar», e conclui-se quando estiver completo. O dia avisa '
          'no fundo enquanto houver lotes por concluir; «Terminar dia» fecha-os como estão, se for essa a '
          'decisão.'),
    ('h2', 'Motivos das cartas chumbadas'),
    ('p', 'Se o teste chumbou cartas, abre-se o bloco dos motivos e distribuem-se as quantidades que '
          'chumbaram pelas seis razões do INCAPE, neste lote:'),
    ('table', ['Categoria', 'Motivo'],
     [['Bio data', 'Biometria: foto ou assinatura errada.'],
      ['Bio data', 'Biometria: outro erro nos dados.'],
      ['Scan', 'Digitalização: qualidade da foto inaceitável.'],
      ['Material', 'Material: laminado defeituoso.'],
      ['Material', 'Material: riscos.'],
      ['Cartão reutilizado', 'Cartão reutilizado: leitura fraca («bad vision»).'],
     ], [0.28, 0.72]),
    ('h2', 'O que o programa recusa'),
    ('table', ['Mensagem', 'O que significa', 'Como corrigir'],
     [['«… rejeitou mais cartas do que produziu»', 'A máquina não pode deitar fora mais do que fez.', 'Confere a guia de produção desse lote.'],
      ['«… chumbou no teste mais cartas do que produziu»', 'A rejeição do teste passa da produção.', 'Confere a contagem do controle de qualidade.'],
      ['«… diz quantas cartas tem o lote»', 'Um lote sem planeadas não se pode comparar com o que saiu.', 'Escreve as cartas do lote.'],
      ['«… tem de indicar a máquina»', 'Falta dizer de que máquina saiu o lote.', 'Escolhe a máquina 1 ou a 2.'],
      ['«Já existe um registo para este dia»', 'O dia já tem registo — nada se conta duas vezes.', 'Edita o dia existente em Registos e acrescenta o lote lá.'],
      ['«as notas não podem ter mais de 500 caracteres»', 'Notas demasiado longas.', 'Resume a nota.'],
     ], [0.32, 0.32, 0.36]),

    ('h1', '7. Armazém: cartões e consumíveis'),
    ('p', 'O Armazém segue o quadro do contrato. Cada material tem o contratado, o entregue (com a data), o '
          'que falta entregar, o que já foi dado às máquinas e o que resta em armazém.'),
    ('table', ['Campo', 'Para que serve'],
     [['Contratado', 'A quantidade do contrato CT/45A001341/AD/0035/2025.'],
      ['Entregue', 'O que já chegou, com a data da entrega.'],
      ['Por entregar', 'Contratado − entregue. O programa calcula; não se escreve.'],
      ['Dado/saído', 'O que já foi consumido pelas máquinas.'],
      ['Em armazém', 'Entregue − dado. É o que está na prateleira.'],
      ['Mínimo de alerta', 'Abaixo deste valor o material fica assinalado a vermelho.'],
     ], [0.26, 0.74]),
    ('p', 'A tira de cima mostra os cartões em armazém, os materiais em alerta, os que faltam entregar e o '
          'número de artigos controlados. A tabela ordena primeiro o que está em falta, e o filtro à direita '
          'deixa ver só um tipo de material.'),
    ('note', 'Porque é que o alerta não olha para os que faltam chegar',
     'Um material que ainda não foi entregue não é uma rutura: é uma entrega pendente. Por isso entra na '
     'lista «por entregar», com destaque próprio, e não na dos mínimos.'),

    ('h1', '8. Lotes: da personalização ao despacho'),
    ('p', 'Cada lote é uma porção de cartas de uma delegação. Passa por quatro fases, sempre pela mesma ordem:'),
    ('table', ['Fase', 'O que acontece', 'O que fica guardado'],
     [['Personalização', 'Os dados do titular entram no cartão.', 'Data e quantidade personalizada.'],
      ['Impressão', 'A carta ganha a imagem e o acabamento.', 'Data e quantidade impressa.'],
      ['Qualidade', 'O controle de qualidade aceita ou chumba.', 'Data em que passou o controle.'],
      ['Despacho', 'O lote segue para a delegação.', 'Data de saída. Sem ela, o lote conta como «por despachar».'],
     ], [0.24, 0.40, 0.36]),
    ('p', 'A tira de cima conta os lotes abertos, os que faltam despachar, os já despachados e o total de '
          'cartas. A tabela mostra uma etiqueta por fase: verde com a data quando está feita, âmbar quando '
          'está em curso e cinzenta quando ainda não começou. O filtro deixa ver só os lotes que faltam numa '
          'fase.'),
    ('p', 'Abrir um lote permite mudar a fase, a quantidade e a data. Quando o despacho fica com data, o lote '
          'fecha-se sozinho.'),

    ('h1', '9. Relatórios: do ecrã para o papel'),
    ('p', 'A vista Relatórios escolhe o que vai no papel. Há oito relatórios:'),
    ('table', ['Apresentar por', 'O que sai'],
     [['Dia / Semana / Mês / Período', 'Produção do período, com cartões por máquina, evolução e totais.'],
      ['Rejeição da máquina / no teste', 'Relatório focado nas cartas deitadas fora, com taxas e quota de cada rejeição.'],
      ['Motivos de rejeição', 'As cartas chumbadas por motivo do INCAPE, com as duas máquinas.'],
      ['Lotes por despachar', 'Os lotes do período, a data de cada fase e o quadro de trabalho.'],
      ['Armazém', 'O material do contrato: contratado, por entregar, entregue, dado e em armazém.'],
      ['Comparar meses / anos', 'Dois períodos lado a lado, com a diferença e uma leitura escrita.'],
     ], [0.34, 0.66]),
    ('steps', ['Escolhe o tipo e o período; a pré-visualização A4 actualiza-se sozinha.',
               'Confere a pré-visualização — é o mesmo desenho do PDF.',
               '«Exportar PDF» guarda o ficheiro; «Imprimir» abre esse PDF no diálogo de impressão.',
               '«Exportar CSV» guarda a mesma matéria em linhas, para o Excel.']),
    ('p', 'Datas sempre dia, mês e ano: 13/11/2026 no ecrã, no papel, no PDF, no CSV e nos nomes dos ficheiros '
          '(nesse caso com hífenes). Meses escrevem-se 11/2026; por extenso ficam «Novembro de 2026».'),
    ('h2', 'O papel por dentro'),
    ('p', 'O relatório tem sempre a mesma ordem: cabeçalho oficial com o logótipo, título e data de geração; '
          'âmbito; indicadores; bloco por máquina; gráfico; registos somados ou a tabela própria do relatório; '
          'notas. O CSV repete a mesma matéria em linhas.'),

    ('h1', '10. Comparar dois períodos'),
    ('p', 'A comparação põe dois períodos lado a lado — dois meses ou dois anos, pela ordem escolhida. A '
          'tabela mostra registos, produzidas, aprovadas, as duas rejeições com as taxas, a aprovação, as '
          'cartas por dia e os dias com registo. A coluna da diferença é o segundo menos o primeiro, em '
          'cartas e em pontos percentuais.'),
    ('p', 'Por baixo, a leitura automática diz o que mudou: «Outubro de 2026 produziu mais 360 cartas do que '
          'Setembro de 2026; a aprovação foi de 98,3% para 98,3%.» Um registo nunca é repartido pelos dois '
          'lados: conta no período em que couber inteiro.'),

    ('h1', '11. Dados fictícios: experimentar sem risco'),
    ('p', '«Ver com dados fictícios» carrega um ano de produção de exemplo — 52 registos, oito lotes e os 25 '
          'artigos do contrato — ao lado dos teus. Nenhum dia já apontado é tocado. O mesmo botão retira '
          'tudo o que é de exemplo, e só isso.'),
    ('p', 'Serve para mostrar o sistema a quem decide, treinar quem vai usar e testar relatórios sem mexer '
          'em números reais.'),

    ('h1', '12. Cópias de segurança'),
    ('p', '«Exportar cópia» grava um .json com tudo: dias com os seus lotes, lotes do quadro, material e a versão dos dados. É o '
          'seguro contra avarias e a forma de levar os dados para outro computador.'),
    ('p', '«Importar cópia» substitui os dados desta máquina pelos do ficheiro, depois de confirmares. '
          'Cópias antigas (v1 a v5) são convertidas automaticamente: os totais por máquina passam a lotes concluídos, '
          'e a nota do registo diz que foi convertido.'),
    ('note', 'Importar substitui, não junta',
     'Antes de importar noutra máquina, exporta de lá uma cópia do que lá está. Duas cópias somam-se à mão, '
     'nunca por cima uma da outra.'),
    ('p', 'Se outra janela guardar entretanto, esta avisa: «Outra janela guardou registos entretanto». Os '
          'números desta janela não foram gravados — recarrega e repete o apontamento.'),

    ('h1', '13. Mensagens de erro e como corrigir'),
    ('table', ['Mensagem (começo)', 'O que aconteceu', 'O que fazer'],
     [['«Não foi possível abrir a base de dados…»', 'A janela do servidor fechou ou o ficheiro está em uso.', 'Confirma que python3 server.py está a correr; volta a abrir.'],
      ['«Outra janela guardou registos entretanto…»', 'Dois trabalhos a escrever ao mesmo tempo.', 'Clica Recarregar; uma janela por computador.'],
      ['«Já existe um registo entre …»', 'Dois registos para os mesmos dias.', 'Edita o existente em Registos.'],
      ['«… não cabem em N produzidas»', 'Rejeições maiores que a produção.', 'Vê a guia da máquina; vazio conta como zero.'],
      ['«Os dados não foram reconhecidos…»', 'O ficheiro importado não é uma cópia do Conta Carta.', 'Verifica que é o .json exportado pela aplicação.'],
      ['«Só se podem converter cópias das versões 1, 2, 3, 4 e 5…»', 'Cópia de uma versão desconhecida.', 'Pede ao responsável de dados.'],
      ['«Sem números para desenhar»', 'O período escolhido não tem produção.', 'Aponta registos ou muda o período.'],
     ], [0.32, 0.32, 0.36]),
    ('h2', 'Quando nada disto resolve'),
    ('steps', ['Exporta uma cópia .json antes de mexer em nada.',
               'Fecha a janela do servidor e volta a abri-la.',
               'Recarrega a página com Ctrl+F5.',
               'Se o problema persistir, leva a cópia e a pasta dados/ ao responsável de dados.']),

    ('pagebreak',),
    ('h1', 'Anexo A. Lista de verificação do turno'),
    ('p', 'Para pendurar ao lado da máquina. Marca cada passo no fim do turno:'),
    ('checks', ['A janela do Conta Carta está aberta e mostra a hora da última gravação.',
                'Todos os lotes do dia estão apontados e concluídos, e o dia foi terminado.',
                'Se o teste chumbou cartas, os motivos do INCAPE estão distribuídos.',
                'Os lotes do dia avançaram de fase e o despacho tem data.',
                'O armazém tem o material recebido e o dado às máquinas actualizado.',
                'O painel confere com a guia de produção (produzidas e rejeições iguais).',
                'A aprovação do dia está dentro do habitual (≥ 90% é o alvo interno).',
                'No fim do mês: relatório mensal em PDF e cópia .json exportada e arquivada.']),

    ('h1', 'Anexo B. Ficha técnica'),
    ('table', ['Item', 'Detalhe'],
     [['Aplicação', 'Conta Carta — registo de produção de cartas de condução, INATRO, IP.'],
      ['Versão dos dados', 'v6 (dias com lotes, lotes do quadro e armazém; cópias v1–v5 convertidas na importação).'],
      ['Arranque', 'python3 server.py → http://localhost:8000 (--port para mudar).'],
      ['Requisitos', 'Python 3.9+; navegador actual; sem pacotes e sem internet.'],
      ['Dados', 'dados/contacarta.sqlite3 (SQLite, um ficheiro, nunca versionado).'],
      ['Saídas', 'PDF A4, CSV para Excel, cópia JSON.'],
      ['Testes', 'node tests/test-core.cjs · test-ui.cjs · test-static.cjs · python3 -m unittest discover -s tests'],
      ['Protecção', 'Nada sai do computador: sem contas, sem cookies de terceiros, sem telemetria.'],
      ['Manual', f'Versão {VERSION} · {DATA}, em PDF e Word.'],
     ], [0.26, 0.74]),
]

STATS = [
    ('Registos de produção', 'um por dia, mês ou intervalo'),
    ('Motivos do INCAPE', 'seis, distribuídos por máquina'),
    ('Lotes', 'quatro fases, da personalização ao despacho'),
    ('Armazém', 'contratado, entregue, por entregar e em stock'),
    ('Relatórios', 'oito, em PDF e CSV'),
]


# --------------------------------------------------------------------------- PDF ---
def pdf_styles():
    return {
        'h1': ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=15, leading=19,
                             textColor=colors.HexColor(GREEN), spaceBefore=2, spaceAfter=7),
        'h2': ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=10.5, leading=13,
                             textColor=colors.HexColor(GREEN_MID), spaceBefore=9, spaceAfter=4),
        'p': ParagraphStyle('p', fontName='Helvetica', fontSize=9.3, leading=13.6, alignment=TA_JUSTIFY,
                            textColor=colors.HexColor(INK), spaceAfter=6),
        'bullet': ParagraphStyle('bullet', fontSize=9.3, leading=13.2, leftIndent=12,
                                 bulletIndent=2, textColor=colors.HexColor(INK), spaceAfter=2),
        'cell': ParagraphStyle('cell', fontSize=7.7, leading=9.9, textColor=colors.HexColor(INK)),
        'head': ParagraphStyle('head', fontName='Helvetica-Bold', fontSize=7.7, leading=9.9,
                               textColor=colors.white),
        'note': ParagraphStyle('note', fontSize=8.6, leading=11.8, textColor=colors.HexColor(INK)),
    }


def add_footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    canvas.setStrokeColor(colors.HexColor(LINE))
    canvas.setLineWidth(0.7)
    canvas.line(20 * mm, 17 * mm, width - 20 * mm, 17 * mm)
    canvas.setFont('Helvetica', 7.4)
    canvas.setFillColor(colors.HexColor(MUTED))
    canvas.drawString(20 * mm, 12 * mm, 'Conta Carta · INATRO, IP — Manual do Utilizador')
    canvas.drawRightString(width - 20 * mm, 12 * mm, f'{VERSION} · {DATA} · pág. {doc.page}')
    canvas.restoreState()


def build_pdf(path: Path):
    styles = pdf_styles()
    doc = BaseDocTemplate(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=18 * mm, bottomMargin=22 * mm,
                          title='Conta Carta — Manual do Utilizador', author='INATRO, IP',
                          subject='Registo de produção de cartas de condução')
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='body')
    doc.addPageTemplates([PageTemplate(id='page', frames=[frame], onPage=add_footer)])

    story = pdf_cover()
    for block in CONTENT:
        kind = block[0]
        if kind == 'pagebreak':
            story.append(PageBreak())
        elif kind == 'h1':
            story.append(Paragraph(block[1], styles['h1']))
        elif kind == 'h2':
            story.append(Paragraph(block[1], styles['h2']))
        elif kind == 'p':
            story.append(Paragraph(block[1], styles['p']))
        elif kind == 'bullet':
            for item in block[1]:
                story.append(Paragraph(item, styles['bullet'], bulletText='•'))
            story.append(Spacer(1, 4))
        elif kind == 'checks':
            for item in block[1]:
                story.append(Paragraph(item, styles['bullet'], bulletText='☐'))
            story.append(Spacer(1, 4))
        elif kind == 'steps':
            for index, item in enumerate(block[1], 1):
                story.append(Paragraph(item, styles['bullet'], bulletText=f'{index}.'))
            story.append(Spacer(1, 4))
        elif kind == 'note':
            story.append(pdf_note(block[1], block[2], styles))
        elif kind == 'table':
            story.append(KeepTogether(pdf_table(block[1], block[2], block[3], styles)[0]))
    doc.build(story)


def pdf_cover():
    width = A4[0] - 40 * mm
    logo = DIST / 'inatro-letterhead.jpg'
    parts = [Image(str(logo), width=width, height=width * 319 / 979, kind='proportional'),
             Spacer(1, 16 * mm)]
    parts.append(Paragraph('Conta Carta', ParagraphStyle('cover', fontName='Helvetica-Bold',
                                                          fontSize=40, leading=44,
                                                          textColor=colors.HexColor(GREEN))))
    parts.append(Paragraph('Manual do Utilizador', ParagraphStyle('cover2', fontName='Helvetica',
                                                                   fontSize=20, leading=24,
                                                                   textColor=colors.HexColor(GREEN_MID))))
    parts.append(Spacer(1, 5 * mm))
    parts.append(Paragraph('Produção, rejeições, motivos do INCAPE, lotes, despacho e armazém — '
                           'do primeiro arranque à cópia de segurança.',
                           ParagraphStyle('lead', fontSize=10.8, leading=15.4,
                                          textColor=colors.HexColor(MUTED))))
    parts.append(Spacer(1, 10 * mm))
    rows = [[Paragraph(f'<b>{name}</b>', pdf_styles()['cell']),
             Paragraph(detail, pdf_styles()['cell'])] for name, detail in STATS]
    table = Table(rows, colWidths=[55 * mm, width - 55 * mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(TINT)),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    parts += [table, Spacer(1, 14 * mm)]
    parts.append(Paragraph(f'Versão {VERSION} · {DATA} · Uso interno do INATRO, IP<br/>'
                           'Instituto Nacional dos Transportes Rodoviários',
                           ParagraphStyle('foot', fontSize=8.4, leading=11.6,
                                          textColor=colors.HexColor(MUTED))))
    parts.append(PageBreak())
    # índice simples
    parts.append(Paragraph('Índice', pdf_styles()['h1']))
    for block in CONTENT:
        if block[0] == 'h1':
            parts.append(Paragraph(block[1], ParagraphStyle('toc', fontSize=9.4, leading=12.4,
                                                            textColor=colors.HexColor(INK))))
    parts.append(PageBreak())
    return parts


def pdf_note(title, text, styles):
    body = [[Paragraph(f'<b>{title}</b>', ParagraphStyle('nt', fontName='Helvetica-Bold',
                                                         fontSize=8.6, textColor=colors.HexColor(AMBER))),
             Paragraph(text, styles['note'])]]
    table = Table(body, colWidths=[36 * mm, A4[0] - 76 * mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(AMBER_TINT)),
        ('LINEBEFORE', (0, 0), (0, -1), 2.4, colors.HexColor(AMBER)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return KeepTogether(table)


def pdf_table(head, rows, widths, styles):
    total = A4[0] - 40 * mm
    columns = [total * share for share in widths]
    data = [[Paragraph(cell, styles['head']) for cell in head]]
    data += [[Paragraph(cell, styles['cell']) for cell in row] for row in rows]
    table = Table(data, colWidths=columns, repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor(GREEN)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 1), (-1, -1), 0.5, colors.HexColor(LINE)),
    ]
    for index in range(1, len(data)):
        if index % 2 == 0:
            style.append(('BACKGROUND', (0, index), (-1, index), colors.HexColor('#f7faf7')))
    table.setStyle(TableStyle(style))
    return [table]


# -------------------------------------------------------------------------- DOCX ---
def shade(cell, hex_color):
    element = OxmlElement('w:shd')
    element.set(qn('w:val'), 'clear')
    element.set(qn('w:color'), 'auto')
    element.set(qn('w:fill'), hex_color.lstrip('#'))
    cell._tc.get_or_add_tcPr().append(element)


def docx_table(document, head, rows, widths):
    table = document.add_table(rows=1, cols=len(head))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    total = 17.0
    # o Word só respeita as larguras se estiverem em cada célula e na grelha
    for index, cell in enumerate(table.rows[0].cells):
        cell.width = Cm(total * widths[index])
        shade(cell, GREEN)
        run = cell.paragraphs[0].add_run(head[index])
        run.bold = True
        run.font.size = Pt(8.5)
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    for row_index, row in enumerate(rows):
        cells = table.add_row().cells
        for index, value in enumerate(row):
            cells[index].width = Cm(total * widths[index])
            run = cells[index].paragraphs[0].add_run(value)
            run.font.size = Pt(8.5)
            if row_index % 2 == 1:
                shade(cells[index], '#f7faf7')
    document.add_paragraph()


def build_docx(path: Path):
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    for side in ('left_margin', 'right_margin'):
        setattr(section, side, Cm(2))
    section.top_margin, section.bottom_margin = Cm(1.8), Cm(2)
    normal = document.styles['Normal']
    normal.font.name = 'Calibri'
    normal.font.size = Pt(10)

    document.add_picture(str(DIST / 'inatro-letterhead.jpg'), width=Cm(17))
    title = document.add_paragraph()
    run = title.add_run('Conta Carta')
    run.bold, run.font.size = True, Pt(34)
    run.font.color.rgb = RGBColor(0x0B, 0x3D, 0x1F)
    sub = document.add_paragraph()
    run = sub.add_run('Manual do Utilizador')
    run.font.size, run.font.color.rgb = Pt(18), RGBColor(0x0E, 0x7A, 0x2E)
    lead = document.add_paragraph('Produção, rejeições, motivos do INCAPE, lotes, despacho e armazém — '
                                  'do primeiro arranque à cópia de segurança.')
    lead.runs[0].font.color.rgb = RGBColor(0x5B, 0x6B, 0x5F)
    docx_table(document, ['Área', 'O que guarda'], STATS, [0.32, 0.68])
    document.add_paragraph(f'Versão {VERSION} · {DATA} · Uso interno do INATRO, IP')
    document.add_page_break()

    for block in CONTENT:
        kind = block[0]
        if kind == 'pagebreak':
            document.add_page_break()
        elif kind == 'h1':
            heading = document.add_heading(block[1], level=1)
            for run in heading.runs:
                run.font.color.rgb = RGBColor(0x0B, 0x3D, 0x1F)
                run.font.size = Pt(15)
        elif kind == 'h2':
            heading = document.add_heading(block[1], level=2)
            for run in heading.runs:
                run.font.color.rgb = RGBColor(0x0E, 0x7A, 0x2E)
                run.font.size = Pt(11.5)
        elif kind == 'p':
            document.add_paragraph(block[1])
        elif kind in ('bullet', 'checks', 'steps'):
            for index, item in enumerate(block[1], 1):
                style = 'List Bullet' if kind == 'bullet' else 'List Number'
                paragraph = document.add_paragraph(item, style=style)
                paragraph.paragraph_format.space_after = Pt(2)
                if kind == 'checks':
                    paragraph.style = document.styles['Normal']
                    paragraph.text = f'☐  {item}'
        elif kind == 'note':
            table = document.add_table(rows=1, cols=1)
            cell = table.rows[0].cells[0]
            shade(cell, AMBER_TINT)
            run = cell.paragraphs[0].add_run(block[1])
            run.bold = True
            run.font.color.rgb = RGBColor(0xA4, 0x6A, 0x12)
            cell.add_paragraph(block[2])
            document.add_paragraph()
        elif kind == 'table':
            docx_table(document, block[1], block[2], block[3])

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = footer.add_run(f'Conta Carta · INATRO, IP — Manual do Utilizador · {VERSION} · {DATA}')
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0x5B, 0x6B, 0x5F)

    document.core_properties.title = 'Conta Carta — Manual do Utilizador'
    document.core_properties.author = 'INATRO, IP'
    document.core_properties.subject = 'Registo de produção de cartas de condução'
    document.save(str(path))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pdf, docx = OUT / 'manual-do-utilizador.pdf', OUT / 'manual-do-utilizador.docx'
    build_pdf(pdf)
    build_docx(docx)
    for path in (pdf, docx):
        print(f'{path.relative_to(ROOT)} · {path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    sys.exit(main())
