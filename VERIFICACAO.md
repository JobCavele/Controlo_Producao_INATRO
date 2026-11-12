# Verificação do projecto

O repositório é distribuído sem registos de produção. Os testes usam exclusivamente dados fictícios e bases temporárias.

## Verificações automatizadas

- Cálculos por máquina e totais; campos vazios como zero.
- Validação de quantidades, datas e duplicação de registos diários.
- Filtros por intervalo e mês, incluindo anos bissextos.
- Gráficos, percentagens globais e estados sem resultados.
- Relatórios, cobertura, tabela compacta e CSV.
- Gravação, reinício, conflitos de revisão, edição, eliminação e restauro.
- Uma base nova inicia com uma lista vazia de registos.

## PDF

O modelo mensal foi renderizado e inspeccionado visualmente em A4, sem cortes na tabela. As amostras geradas são ficheiros locais excluídos do Git. A navegação interactiva e a responsividade geral não foram validadas visualmente nesta revisão.

## Executar novamente

```text
node tests/test-core.cjs
node verify-dashboard.cjs
python -m unittest discover -s tests -p "test_*.py"
```
