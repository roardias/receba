"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

type LinhaBasal = {
  grupo: string;
  cnpj: string;
};

function somenteNumeros(val: string | null | undefined): string {
  return (val || "").replace(/\D/g, "");
}

export default function Basal2026Page() {
  const [preview, setPreview] = useState<LinhaBasal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
   const [status, setStatus] = useState<string | null>(null);
   const [progresso, setProgresso] = useState<number>(0);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null);
    setPreview(null);
    setStatus(null);
    setProgresso(0);
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      setStatus("Lendo e validando planilha...");
      setProgresso(10);
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });

      const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "basal 2026 v1".toLowerCase());
      if (!sheetName) {
        setErro('A aba "BASAL 2026 V1" não foi encontrada na planilha.');
        setStatus(null);
        return;
      }

      const sheet = wb.Sheets[sheetName];
      // raw: false faz o XLSX usar preferencialmente o valor "formatado" da célula.
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
      if (rows.length < 3) {
        setErro("Planilha sem dados para importar (é esperado cabeçalho na linha 2 e dados a partir da linha 3).");
        setStatus(null);
        return;
      }

      const linhas: LinhaBasal[] = [];
      const problemas: string[] = [];

      setProgresso(30);
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i] || [];
        const grupoRaw = String(row[0] ?? "").trim();

        // Ler o CNPJ diretamente da célula da coluna E (índice 4), priorizando o texto formatado (.w)
        const cellAddr = XLSX.utils.encode_cell({ r: i, c: 4 });
        const cell = (sheet as any)[cellAddr];
        const cnpjRaw = cell ? String((cell.w ?? cell.v) ?? "").trim() : "";
        const cnpjDigits = somenteNumeros(cnpjRaw);

        if (!grupoRaw && !cnpjRaw) {
          continue;
        }

        if (!grupoRaw) {
          problemas.push(`Linha ${i + 1}: Grupo vazio.`);
          continue;
        }

        if (!cnpjDigits) {
          problemas.push(`Linha ${i + 1}: CNPJ vazio.`);
          continue;
        }

        if (cnpjDigits.length !== 14) {
          problemas.push(`Linha ${i + 1}: CNPJ deve ter 14 dígitos após remover máscara (atual: ${cnpjDigits.length}).`);
          continue;
        }

        linhas.push({
          grupo: grupoRaw,
          cnpj: cnpjDigits,
        });
      }

      if (linhas.length === 0) {
        setErro(
          problemas.length
            ? `Nenhuma linha válida para importar.\n${problemas.slice(0, 10).join("\n")}${
                problemas.length > 10 ? `\n… e mais ${problemas.length - 10} linha(s) com problema.` : ""
              }`
            : "Nenhuma linha válida encontrada na planilha."
        );
        setStatus(null);
        return;
      }

      if (problemas.length) {
        setErro(
          `Algumas linhas foram ignoradas por problemas de validação:\n${problemas
            .slice(0, 10)
            .join("\n")}${problemas.length > 10 ? `\n… e mais ${problemas.length - 10} linha(s).` : ""}`
        );
      }

      setPreview(linhas);
      setStatus("Pré-visualização pronta. Revise e clique em Confirmar importação.");
      setProgresso(70);
    } catch (err) {
      console.error(err);
      setErro(err instanceof Error ? err.message : "Erro ao processar planilha");
      setStatus(null);
      setProgresso(0);
    }
  }

  async function confirmarImportacao() {
    if (!preview || preview.length === 0) return;
    setImportando(true);
    setErro(null);
    try {
      setStatus("Limpando tabela empresas_grupo_basal...");
      setProgresso(10);
      const payload = preview.map((l) => ({
        grupo: l.grupo,
        cnpj: l.cnpj,
      }));

      // Estratégia simples: limpar e inserir tudo de novo
      await supabase.from("empresas_grupo_basal").delete().neq("cnpj", ""); // filtro qualquer só para permitir delete-all
      setStatus("Gravando registros importados...");

      const batchSize = 500;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        const { error } = await supabase.from("empresas_grupo_basal").insert(batch);
        if (error) throw error;
        const progressLocal = 10 + Math.round(((i + batch.length) / payload.length) * 80);
        setProgresso(progressLocal);
      }

      setPreview(null);
      setStatus("Importação concluída com sucesso.");
      setProgresso(100);
    } catch (err) {
      console.error(err);
      setErro(err instanceof Error ? err.message : "Erro ao salvar dados no Supabase");
      setStatus(null);
      setProgresso(0);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Basal 2026</h1>
      <p className="text-slate-600 mt-1">
        Importe a aba <strong>BASAL 2026 V1</strong>. Será usada a coluna <strong>A</strong> (Grupo) e a coluna{" "}
        <strong>E</strong> (CNPJ), a partir da linha 3. O CNPJ é normalizado para conter apenas 14 dígitos (sem pontos,
        barras ou traços).
      </p>

      <div className="mt-6 space-y-4">
        <label className="inline-flex items-center px-4 py-2 bg-slate-800 text-white rounded cursor-pointer hover:bg-slate-700">
          Selecionar planilha
          <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
        </label>

        {(status || importando || progresso > 0) && (
          <div className="space-y-1 max-w-md">
            {status && <p className="text-xs text-slate-600">{status}</p>}
            <div className="w-full h-2 bg-slate-200 rounded overflow-hidden">
              <div
                className="h-2 bg-slate-700 transition-all"
                style={{ width: `${Math.min(Math.max(progresso, 0), 100)}%` }}
              />
            </div>
          </div>
        )}

        {erro && (
          <pre className="whitespace-pre-wrap text-red-700 bg-red-50 px-4 py-2 rounded text-sm">{erro}</pre>
        )}

        {preview && (
          <div className="border rounded p-4 bg-slate-50">
            <p className="font-medium text-slate-700 mb-2">
              {preview.length} linha(s) válidas prontas para importar na tabela <code>empresas_grupo_basal</code>.
            </p>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={confirmarImportacao}
                disabled={importando}
                className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {importando ? "Importando..." : "Confirmar importação"}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-4 py-2 border rounded hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>

            <div className="max-h-64 overflow-auto border rounded bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Grupo</th>
                    <th className="text-left p-2">CNPJ (somente números)</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{l.grupo}</td>
                      <td className="p-2">{l.cnpj}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 50 && (
                <p className="p-2 text-slate-500 text-xs">… e mais {preview.length - 50} linha(s).</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

