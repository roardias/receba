"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type ConfigEmpresa = {
  id: string;
  nome: string | null;
  logo_url: string | null;
  background_color: string;
  updated_at: string;
};

export default function MinhaEmpresaPage() {
  const { hasPermissao } = useAuth();
  const podeEditar = hasPermissao("config_minha_empresa_imagem_cor");

  const [config, setConfig] = useState<ConfigEmpresa | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoRemovida, setLogoRemovida] = useState(false);

  async function carregar() {
    const { data, error } = await supabase
      .from("config_empresa")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) {
      setErro(error.message);
      setLoading(false);
      return;
    }
    if (data) {
      setConfig(data as ConfigEmpresa);
      setNome(data.nome ?? "");
      setBackgroundColor(data.background_color || "#FFFFFF");
      setLogoUrl(data.logo_url ?? null);
    setLogoRemovida(false);
    }
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErro("Selecione um arquivo de imagem (PNG, JPG, etc.).");
      return;
    }
    setLogoFile(file);
    setLogoRemovida(false);
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
    setErro(null);
  }

  function removerLogo() {
    setLogoFile(null);
    setLogoUrl(null);
    setLogoRemovida(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSaving(true);

    let urlFinal: string | null = null;
    if (logoRemovida) {
      urlFinal = null;
    } else if (logoFile) {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(logoFile);
      });
      urlFinal = dataUrl;
    } else {
      urlFinal = logoUrl ?? config?.logo_url ?? null;
    }

    const payload = {
      nome: nome.trim() || null,
      logo_url: urlFinal,
      background_color: backgroundColor,
      updated_at: new Date().toISOString(),
    };

    if (config?.id) {
      const { error } = await supabase
        .from("config_empresa")
        .update(payload)
        .eq("id", config.id);
      if (error) {
        setErro(error.message);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase.from("config_empresa").insert(payload);
      if (error) {
        setErro(error.message);
        setSaving(false);
        return;
      }
    }

    setLogoFile(null);
    setLogoRemovida(false);
    await carregar();
    setSaving(false);
  }

  if (loading) return <p className="text-slate-600">Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Minha empresa</h1>
      <p className="text-slate-600 mt-1">
        Nome, logomarca e cor de fundo usados nos relatórios.
      </p>
      {!podeEditar && (
        <p className="mt-2 text-amber-700 text-sm">
          Somente visualização. A permissão para alterar nome, imagem e cor é definida no Cadastro de usuários.
        </p>
      )}

      <form onSubmit={salvar} className="mt-6 space-y-6 max-w-xl">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Nome (aparece nos relatórios)
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome da empresa"
            disabled={!podeEditar}
            className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-slate-500 focus:border-slate-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Logomarca
          </label>
          <div className="flex flex-wrap gap-4 items-start">
            {(logoUrl ?? config?.logo_url) && !logoRemovida && (
              <div
                className="border rounded p-2 flex items-center justify-center"
                style={{ backgroundColor }}
              >
                <img
                  src={logoUrl ?? config?.logo_url ?? ""}
                  alt="Logo"
                  className="max-h-24 max-w-[200px] object-contain"
                />
              </div>
            )}
            {podeEditar && (
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="text-sm text-slate-600"
                />
                {(logoUrl ?? config?.logo_url) && !logoRemovida && (
                  <button
                    type="button"
                    onClick={removerLogo}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remover logo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Cor de fundo (atrás da logo nos relatórios)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              disabled={!podeEditar}
              className="h-10 w-14 cursor-pointer rounded border border-slate-300 disabled:cursor-not-allowed"
            />
            <input
              type="text"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              disabled={!podeEditar}
              className="px-3 py-2 border border-slate-300 rounded w-24 font-mono text-sm disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {erro && (
          <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{erro}</p>
        )}

        {podeEditar && (
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        )}
      </form>
    </div>
  );
}
