# Por que às vezes dá erro 23503 (FK movimentos → clientes)?

## O que é o erro

- **Código:** `23503` (violação de foreign key)
- **Constraint:** `fk_movimentos_clientes`
- **Significado:** Está sendo inserido/atualizado um registro em `movimentos` cujo `chave_cliente` (ex.: `Alldax 3_11745786156`) **não existe** na tabela `clientes` (coluna `chave_unica`).

Ou seja: o movimento referencia um cliente que, naquele momento, não está cadastrado em `clientes`.

## Por que “às vezes” dá e às vezes não?

Nenhuma regra ou chave do banco muda entre uma execução e outra. O que muda é **quem já está em `clientes`** no momento em que o sync de movimentos roda:

1. **Ordem do sync**  
   O scheduler roda na ordem: **clientes** → categorias → **movimentos** → …  
   Em condições normais, quando movimentos roda, os clientes daquela empresa já deveriam estar em `clientes`. Por isso **na maioria das vezes** não dá erro.

2. **Omie não devolve todos os clientes em todas as chamadas**  
   - A API de **Contas a Receber (movimentos)** pode trazer títulos com `det_nCodCliente = 11745786156`.  
   - A API de **ListarClientes** pode não trazer esse código (ex.: cliente inativo, filtro, paginação, falha em uma página).  
   Se esse cliente nunca entrou (ou saiu) de `clientes`, no próximo sync de movimentos o `chave_cliente` `Alldax 3_11745786156` não existe e a FK dispara o 23503.

3. **Cliente novo no Omie**  
   Pode existir título a receber para um cliente recém-criado. Se o sync de clientes ainda não rodou (ou rodou antes do cliente ser criado), `clientes` não tem esse código e o insert em movimentos falha.

4. **Falha ou ordem diferente em uma execução**  
   Se em alguma execução o sync de clientes falhou para essa empresa, ou movimentos rodou antes (ex.: trigger manual, outro processo), de novo `chave_cliente` pode não existir em `clientes` e o erro aparece.

Resumindo: **não é bug de regra ou de chave no SQL**; é dependência de **dados e ordem**: o movimento referencia um cliente que, naquela hora, ainda não está (ou não está mais) em `clientes`.

## O que fazer

- **Garantir que todo `chave_cliente` usado em movimentos exista em `clientes`** antes de inserir em `movimentos`.  
  Por exemplo: no script de sync de movimentos, para cada `(empresa, det_nCodCliente)` que for inserido, fazer um **UPSERT em `clientes`** com esse `empresa` e `codigo_cliente_omie` (e o mínimo de campos obrigatórios), criando um “stub” se o cliente ainda não existir. Assim a FK é sempre respeitada e o erro 23503 deixa de ocorrer nesse caso.

Se quiser, no próximo passo podemos desenhar exatamente esse UPSERT (campos e ordem no script de sync).
