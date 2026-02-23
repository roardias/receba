"use client";

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import Papa from "papaparse";

type Acessoria = {
  id: string;
  id_planilha: string;
  grupo_empresas: string;
  razao_social: string | null;
  tag_top_40: string | null;
  created_at: string;
};

type LinhaImport = {
  id_planilha: string;
  grupo_empresas: string;
  razao_social: string | null;
  tag_top_40: string | null;
};

const TOP_40_TAG = "Top - 40";

function extrairTop40(tags: string | null | undefined): string | null {
  if (!tags || typeof tags !== "string") return null;
  const s = String(tags).trim();
  if (!s) return null;
  if (s.includes(TOP_40_TAG)) return TOP_40_TAG;
  return null;
}

function normalizarColuna(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function encontrarColuna(headers: string[], candidatos: string[]): number {
  const normHeaders = headers.map(normalizarColuna);
  for (const c of candidatos) {
    const nc = normalizarColuna(c);
    const idx = normHeaders.findIndex((h) => h === nc || h.includes(nc));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parsearPlanilha(file: File): Promise<LinhaImport[]> {
  const LOG = "[Acessorias import]";
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          console.error(LOG, "Arquivo vazio");
          reject(new Error("Arquivo vazio"));
          return;
        }
        const linhas: LinhaImport[] = [];
        if (file.name.toLowerCase().endsWith(".csv")) {
          const text = typeof data === "string" ? data : new TextDecoder("utf-8").decode(data as ArrayBuffer);
          const sep = text.includes(";") ? ";" : ",";
          console.log(LOG, "CSV: delimitador=", sep, "primeiros 200 chars:", text.slice(0, 200));
          const parsed = Papa.parse(text, {
            delimiter: sep,
            skipEmptyLines: true,
            quoteChar: '"',
            escapeChar: '"',
          });
          if (parsed.errors.length > 0) {
            console.warn(LOG, "Avisos/erros Papa:", parsed.errors);
          }
          if (parsed.errors.length > 0 && !parsed.data?.length) {
            const msg = parsed.errors[0]?.message || "Erro ao parsear CSV";
            console.error(LOG, "CSV parse falhou:", msg, parsed.errors);
            reject(new Error(msg));
            return;
          }
          const rows = parsed.data || [];
          if (rows.length < 2) {
            console.log(LOG, "CSV: menos de 2 linhas, retornando vazio");
            resolve([]);
            return;
          }
          const headers = rows[0].map((h: unknown) => String(h ?? "").trim());
          console.log(LOG, "CSV headers:", headers);
          const idxId = encontrarColuna(headers, ["id", "ID"]);
          const idxGrupo = encontrarColuna(headers, ["grupo de empresas", "grupo", "grupo_empresas"]);
          const idxRazao = encontrarColuna(headers, ["razao social", "razao_social", "razaosocial"]);
          const idxTags = encontrarColuna(headers, ["tags", "tag"]);
          console.log(LOG, "CSV índices: id=", idxId, "grupo=", idxGrupo, "razao=", idxRazao, "tags=", idxTags);
          if (idxId < 0 || idxGrupo < 0 || idxTags < 0) {
            const faltando = [
              idxId < 0 && "ID",
              idxGrupo < 0 && "Grupo de Empresas",
              idxTags < 0 && "Tags",
            ].filter(Boolean);
            console.error(LOG, "Colunas obrigatórias não encontradas:", faltando, "headers:", headers);
            reject(new Error("Colunas obrigatórias não encontradas: ID, Grupo de Empresas, Tags"));
            return;
          }
          for (let i = 1; i < rows.length; i++) {
            const cols = rows[i];
            const idPlanilha = (cols[idxId] ?? "").trim();
            const grupoEmpresas = (cols[idxGrupo] ?? "").trim();
            const razaoSocial = idxRazao >= 0 ? (cols[idxRazao] ?? "").trim() || null : null;
            const tags = (cols[idxTags] ?? "").trim();
            if (!idPlanilha && !grupoEmpresas) continue;
            linhas.push({
              id_planilha: idPlanilha || "-",
              grupo_empresas: grupoEmpresas || "-",
              razao_social: razaoSocial,
              tag_top_40: extrairTop40(tags),
            });
          }
          console.log(LOG, "CSV linhas válidas:", linhas.length);
        } else {
          const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? "array" : "binary" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (!json.length) {
            console.log(LOG, "XLSX: planilha vazia");
            resolve([]);
            return;
          }
          const headerRow = json[0] as unknown as unknown[];
          const headers = headerRow.map((h) => String(h ?? ""));
          console.log(LOG, "XLSX headers:", headers);
          const idxId = encontrarColuna(headers, ["id", "ID"]);
          const idxGrupo = encontrarColuna(headers, ["grupo de empresas", "grupo", "grupo_empresas"]);
          const idxRazao = encontrarColuna(headers, ["razao social", "razao_social", "razaosocial"]);
          const idxTags = encontrarColuna(headers, ["tags", "tag"]);
          console.log(LOG, "XLSX índices: id=", idxId, "grupo=", idxGrupo, "razao=", idxRazao, "tags=", idxTags);
          if (idxId < 0 || idxGrupo < 0 || idxTags < 0) {
            const faltando = [
              idxId < 0 && "ID",
              idxGrupo < 0 && "Grupo de Empresas",
              idxTags < 0 && "Tags",
            ].filter(Boolean);
            console.error(LOG, "Colunas obrigatórias não encontradas:", faltando, "headers:", headers);
            reject(new Error("Colunas obrigatórias não encontradas: ID, Grupo de Empresas, Tags"));
            return;
          }
          for (let i = 1; i < json.length; i++) {
            const row = json[i] as unknown as unknown[];
            const idPlanilha = String(row[idxId] ?? "").trim();
            const grupoEmpresas = String(row[idxGrupo] ?? "").trim();
            const razaoSocial = idxRazao >= 0 ? (String(row[idxRazao] ?? "").trim() || null) : null;
            const tags = String(row[idxTags] ?? "").trim();
            if (!idPlanilha && !grupoEmpresas) continue;
            linhas.push({
              id_planilha: idPlanilha || "-",
              grupo_empresas: grupoEmpresas || "-",
              razao_social: razaoSocial,
              tag_top_40: extrairTop40(tags),
            });
          }
          console.log(LOG, "XLSX linhas válidas:", linhas.length);
        }
        resolve(linhas);
      } catch (err) {
        console.error(LOG, "Exceção ao processar planilha:", err);
        reject(err);
      }
    };
    reader.onerror = () => {
      console.error(LOG, "Erro FileReader:", reader.error);
      reject(new Error("Erro ao ler arquivo"));
    };
    if (file.name.toLowerCase().endsWith(".csv")) {
      reader.readAsText(file, "UTF-8");
    } else {
      reader.readAsArrayBuffer(file);
    }
    console.log(LOG, "Lendo arquivo:", file.name, "tamanho:", file.size, "tipo:", file.type);
  });
}

export default function AcessoriasPage() {
  const [acessorias, setAcessorias] = useState<Acessoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const [preview, setPreview] = useState<LinhaImport[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("acessorias").select("*").order("grupo_empresas");
    setAcessorias(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErro(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const LOG = "[Acessorias import]";
    try {
      console.log(LOG, "Iniciando parse do arquivo:", file.name);
      const linhas = await parsearPlanilha(file);
      if (linhas.length === 0) {
        console.warn(LOG, "Nenhuma linha válida");
        setErro("Nenhuma linha válida encontrada na planilha.");
        return;
      }
      console.log(LOG, "Preview ok, linhas:", linhas.length);
      setPreview(linhas);
    } catch (err) {
      console.error(LOG, "handleFile erro:", err);
      setErro(err instanceof Error ? err.message : "Erro ao processar planilha");
    }
    e.target.value = "";
  }

  async function confirmarImportacao() {
    if (!preview || preview.length === 0) return;
    const LOG = "[Acessorias import]";
    setImportando(true);
    setErro(null);
    try {
      const payload = preview.map((l) => ({
        id_planilha: l.id_planilha,
        grupo_empresas: l.grupo_empresas,
        razao_social: l.razao_social,
        tag_top_40: l.tag_top_40,
      }));
      console.log(LOG, "Upsert", payload.length, "registros (atualiza existentes por ID, insere novos). Amostra 1ª linha:", payload[0]);
      const { data, error } = await supabase
        .from("acessorias")
        .upsert(payload, { onConflict: "id_planilha" })
        .select("id");
      if (error) {
        console.error(LOG, "Erro no upsert:", error.message, "code:", error.code, "details:", error.details, "hint:", error.hint);
        throw error;
      }
      console.log(LOG, "Upsert ok, retornados:", data?.length ?? 0);
      const { data: syncCount, error: refreshErr } = await supabase.rpc("refresh_dashboard_receber_apos_acessorias");
      if (refreshErr) {
        console.warn(LOG, "Atualização de grupos + view (não bloqueante):", refreshErr.message);
      } else if (typeof syncCount === "number" && syncCount > 0) {
        console.log(LOG, "Clientes com grupo atualizado:", syncCount, "| view_dashboard_receber atualizada.");
      } else {
        console.log(LOG, "Grupos e view_dashboard_receber atualizados.");
      }
      setPreview(null);
      await carregar();
    } catch (err) {
      console.error(LOG, "confirmarImportacao erro:", err);
      setErro(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setImportando(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Acessórias</h1>
      <p className="text-slate-600 mt-1">
        Importe a planilha de cadastro. Colunas: ID, Grupo de Empresas, Razão Social, Tags (extrai Top - 40 quando houver).
        A importação faz <strong>upgrade</strong>: registros com o mesmo ID são atualizados; novos IDs são inseridos. Nenhum dado é apagado.
      </p>

      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="px-4 py-2 bg-slate-800 text-white rounded cursor-pointer hover:bg-slate-700">
            Selecionar planilha
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              className="hidden"
            />
          </label>
        </div>

        {erro && (
          <p className="text-red-600 bg-red-50 px-4 py-2 rounded">{erro}</p>
        )}

        {preview && (
          <div className="border rounded p-4 bg-slate-50">
            <p className="font-medium text-slate-700 mb-2">
              {preview.length} linha(s) prontas para importar. {preview.filter((l) => l.tag_top_40).length} com Top - 40.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirmarImportacao}
                disabled={importando}
                className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {importando ? "Importando..." : "Confirmar importação"}
              </button>
              <button
                onClick={() => setPreview(null)}
                className="px-4 py-2 border rounded hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
            <div className="mt-4 max-h-48 overflow-auto border rounded bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Grupo de Empresas</th>
                    <th className="text-left p-2">Razão Social</th>
                    <th className="text-left p-2">Top - 40</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 20).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{l.id_planilha}</td>
                      <td className="p-2">{l.grupo_empresas}</td>
                      <td className="p-2 max-w-[200px] truncate" title={l.razao_social ?? undefined}>{l.razao_social ?? "—"}</td>
                      <td className="p-2">{l.tag_top_40 ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 20 && (
                <p className="p-2 text-slate-500 text-sm">… e mais {preview.length - 20} linhas</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Registros importados</h2>
          {loading ? (
            <p className="text-slate-500">Carregando...</p>
          ) : acessorias.length === 0 ? (
            <p className="text-slate-500">Nenhum registro. Importe uma planilha.</p>
          ) : (
            <div className="overflow-x-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Grupo de Empresas</th>
                    <th className="text-left p-2">Razão Social</th>
                    <th className="text-left p-2">Top - 40</th>
                  </tr>
                </thead>
                <tbody>
                  {acessorias.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-slate-50">
                      <td className="p-2">{a.id_planilha}</td>
                      <td className="p-2">{a.grupo_empresas}</td>
                      <td className="p-2 max-w-[200px] truncate" title={a.razao_social ?? undefined}>{a.razao_social ?? "—"}</td>
                      <td className="p-2">{a.tag_top_40 ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
