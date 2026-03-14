"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";

type LinhaBasal = {
  grupo: string;
  cnpj: string;
};

function somenteNumeros(val: string | null | undefined): string {
  return (val || "").replace(/\D/g, "");
}

export default function Basal2026Page() {
  const router = useRouter();
  const { profile, loading, hasPermissao } = useAuth();
  const [preview, setPreview] = useState<LinhaBasal[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<number>(0);

  useEffect(() => {
    if (!loading && profile && !hasPermissao("menu_basal")) {
      router.replace("/dashboard");
    }
  }, [loading, profile, hasPermissao, router]);

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

      // Há mais de uma aba com nome parecido; priorize exatamente "BASAL 2026 V1 "
      const desiredOrder = ["BASAL 2026 V1 ", "BASAL 2026 V1"];
      let sheetName: string | undefined;
      for (const desired of desiredOrder) {
        sheetName = wb.SheetNames.find((n) => n === desired);
        if (sheetName) break;
      }
      // fallback: comparar por trim/lower se no futuro o nome mudar levemente
      if (!sheetName) {
        sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "basal 2026 v1".toLowerCase());
      }

      if (!sheetName) {
        setErro('A aba "BASAL 2026 V1" não foi encontrada na planilha.');
        setStatus(null);
        return;
      }

      const sheet = wb.Sheets[sheetName];
      // Ajustar o range para começar na linha 2 (índice 1), onde está o cabeçalho:
      const ref = sheet["!ref"];
      if (!ref) {
        setErro("Planilha sem área de dados definida.");
        setStatus(null);
        return;
      }
      const range = XLSX.utils.decode_range(ref);
      // linha 2 em Excel = índice 1
      range.s.r = 1;

      // raw: false faz o XLSX usar preferencialmente o valor "formatado" da célula.
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        range,
      });
      // Esperamos: rows[0] = cabeçalho (GRUPO, EMPRESA, ..., CNPJ)
      if (rows.length < 2) {
        setErro("Planilha sem dados para importar (é esperado cabeçalho na linha 2 e dados a partir da linha 3).");
        setStatus(null);
        return;
      }

      const linhas: LinhaBasal[] = [];
      const problemas: string[] = [];

      setProgresso(30);
      // i = 1 → linha 3 em Excel (primeira linha de dados)
      for (let i = 1; i < rows.length; i++) {
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
          problemas.push(`Linha ${i + 1}: CNPJ vazio (valor original: "${cnpjRaw}").`);
          continue;
        }

        // Após remover espaços e qualquer caractere que não seja dígito,
        // o CNPJ DEVE ter exatamente 14 dígitos.
        if (cnpjDigits.length !== 14) {
          problemas.push(
            `Linha ${i + 1}: CNPJ deve ter 14 dígitos após remover máscara (atual: ${cnpjDigits.length}). Valor original: "${cnpjRaw}", valor numérico: "${cnpjDigits}".`
          );
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
      // Deduplicar por (grupo, cnpj) para evitar conflito no upsert
      const seen = new Set<string>();
      const payload: { grupo: string; cnpj: string }[] = [];
      for (const l of preview) {
        const key = `${l.grupo}|${l.cnpj}`;
        if (seen.has(key)) continue;
        seen.add(key);
        payload.push({ grupo: l.grupo, cnpj: l.cnpj });
      }

      setStatus("Gravando registros na tabela empresas_grupo_basal...");
      setProgresso(10);

      const batchSize = 500;
      for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        const { error } = await supabase
          .from("empresas_grupo_basal")
          .upsert(batch, { onConflict: "grupo,cnpj", ignoreDuplicates: false });
        if (error) {
          const msg = [error.message, error.details, error.hint].filter(Boolean).join(" | ");
          throw new Error(msg || "Erro Supabase");
        }
        const progressLocal = 10 + Math.round(((i + batch.length) / payload.length) * 80);
        setProgresso(progressLocal);
      }

      setPreview(null);
      setStatus("Importação concluída com sucesso.");
      setProgresso(100);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Erro ao salvar dados no Supabase";
      setErro(msg);
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

