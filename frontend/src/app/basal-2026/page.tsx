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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });

      const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "basal 2026 v1".toLowerCase());
      if (!sheetName) {
        setErro('A aba "BASAL 2026 V1" não foi encontrada na planilha.');
        return;
      }

      const sheet = wb.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows.length < 3) {
        setErro("Planilha sem dados para importar (é esperado cabeçalho na linha 2 e dados a partir da linha 3).");
        return;
      }

      const linhas: LinhaBasal[] = [];
      const problemas: string[] = [];

      for (let i = 2; i < rows.length; i++) {
        const row = rows[i] || [];
        const grupoRaw = String(row[0] ?? "").trim();
        const cnpjRaw = String(row[4] ?? "").trim();
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
    } catch (err) {
      console.error(err);
      setErro(err instanceof Error ? err.message : "Erro ao processar planilha");
    }
  }

  async function confirmarImportacao() {
    if (!preview || preview.length === 0) return;
    setImportando(true);
    setErro(null);
    try {
      const payload = preview.map((l) => ({
        grupo: l.grupo,
        cnpj: l.cnpj,
      }));

      // Estratégia simples: limpar e inserir tudo de novo
      await supabase.from("empresas_grupo_basal").delete().neq("cnpj", ""); // filtro qualquer só para permitir delete-all
      const { error } = await supabase.from("empresas_grupo_basal").insert(payload);
      if (error) throw error;

      setPreview(null);
    } catch (err) {
      console.error(err);
      setErro(err instanceof Error ? err.message : "Erro ao salvar dados no Supabase");
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

