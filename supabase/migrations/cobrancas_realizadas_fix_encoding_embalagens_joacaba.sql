-- Corrige encoding quebrado: Embalagens Joaã‡Aba / Embalagens JoaçaAba -> Embalagens Joaçaba

UPDATE cobrancas_realizadas
SET cliente_nome = 'Embalagens Joaçaba'
WHERE cliente_nome IN ('Embalagens Joaã‡Aba', 'Embalagens JoaçaAba')
   OR cliente_nome LIKE 'Embalagens Joa%Aba';

UPDATE cobrancas_realizadas
SET grupo_nome = 'Embalagens Joaçaba'
WHERE grupo_nome IN ('Embalagens Joaã‡Aba', 'Embalagens JoaçaAba')
   OR grupo_nome LIKE 'Embalagens Joa%Aba';

UPDATE cobrancas_realizadas
SET empresas_internas_nomes = 'Embalagens Joaçaba'
WHERE empresas_internas_nomes IN ('Embalagens Joaã‡Aba', 'Embalagens JoaçaAba')
   OR empresas_internas_nomes LIKE 'Embalagens Joa%Aba';
