"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Empresa = { id: string; nome_curto: string; razao_social: string };
type ConfigEmail = {
  id: string;
  tenant_id: string;
  client_id: string;
  client_secret_encrypted: string | null;
  sender_mailbox: string;
  sender_name: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};
type ConfigComEmpresas = ConfigEmail & { config_email_empresas: { empresa_id: string }[] };

export default function EmailConfigPage() {
  const { hasPermissao } = useAuth();
  const [lista, setLista] = useState<ConfigComEmpresas[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ConfigComEmpresas | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [senderMailbox, setSenderMailbox] = useState("");
  const [senderName, setSenderName] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [empresaIds, setEmpresaIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [mostrarSecret, setMostrarSecret] = useState(false);
  const [testeConfigId, setTesteConfigId] = useState("");
  const [testeTo, setTesteTo] = useState("");
  const [testeAssunto, setTesteAssunto] = useState("Teste - Sistema Receba");
  const [testeDescricao, setTesteDescricao] = useState("Este é um e-mail de teste do sistema Receba.");
  const [testeEnviando, setTesteEnviando] = useState(false);
  const [testeSucesso, setTesteSucesso] = useState<string | null>(null);
  const [testeErro, setTesteErro] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    const [resConfig, resEmpresas] = await Promise.all([
      supabase
        .from("config_email")
        .select("*, config_email_empresas(empresa_id)")
        .order("created_at", { ascending: false }),
      supabase.from("empresas").select("id, nome_curto, razao_social").order("nome_curto"),
    ]);
    if (resConfig.error) {
      setErro(resConfig.error.message);
      setLista([]);
    } else {
      setLista((resConfig.data as ConfigComEmpresas[]) || []);
    }
    setEmpresas(resEmpresas.data || []);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function limparForm() {
    setEditando(null);
    setTenantId("");
    setClientId("");
    setClientSecret("");
    setSenderMailbox("");
    setSenderName("");
    setAtivo(true);
    setEmpresaIds([]);
    setMostrarSecret(false);
  }

  function iniciarEdicao(c: ConfigComEmpresas) {
    setEditando(c);
    setTenantId(c.tenant_id);
    setClientId(c.client_id);
    setClientSecret("");
    setSenderMailbox(c.sender_mailbox);
    setSenderName(c.sender_name);
    setAtivo(c.ativo);
    setEmpresaIds((c.config_email_empresas || []).map((e) => e.empresa_id));
    setMostrarSecret(false);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!senderMailbox.trim() || !senderName.trim() || !tenantId.trim() || !clientId.trim()) {
      setErro("Preencha Tenant ID, Client ID, E-mail remetente e Nome remetente.");
      return;
    }
    setSaving(true);
    setErro(null);

    let clientSecretEncrypted: string | null = null;
    if (clientSecret.trim()) {
      const resEnc = await fetch("/api/criptografar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: clientSecret.trim() }),
      });
      const j = await resEnc.json();
      if (!resEnc.ok || !j.encrypted) {
        setErro(j.error || "Falha ao criptografar Client Secret.");
        setSaving(false);
        return;
      }
      clientSecretEncrypted = j.encrypted;
    }

    if (editando) {
      const payload: Record<string, unknown> = {
        tenant_id: tenantId.trim(),
        client_id: clientId.trim(),
        sender_mailbox: senderMailbox.trim(),
        sender_name: senderName.trim(),
        ativo,
        updated_at: new Date().toISOString(),
      };
      if (clientSecretEncrypted) payload.client_secret_encrypted = clientSecretEncrypted;

      const { error: errUpdate } = await supabase
        .from("config_email")
        .update(payload)
        .eq("id", editando.id);
      if (errUpdate) {
        setErro(errUpdate.message);
        setSaving(false);
        return;
      }

      await supabase.from("config_email_empresas").delete().eq("config_email_id", editando.id);
      if (empresaIds.length > 0) {
        await supabase.from("config_email_empresas").insert(
          empresaIds.map((empresa_id) => ({ config_email_id: editando.id, empresa_id }))
        );
      }
    } else {
      if (!clientSecretEncrypted) {
        setErro("Informe o Client Secret para nova configuração.");
        setSaving(false);
        return;
      }
      const { data: inserted, error: errInsert } = await supabase
        .from("config_email")
        .insert({
          tenant_id: tenantId.trim(),
          client_id: clientId.trim(),
          client_secret_encrypted: clientSecretEncrypted,
          sender_mailbox: senderMailbox.trim(),
          sender_name: senderName.trim(),
          ativo,
        })
        .select("id")
        .single();
      if (errInsert || !inserted) {
        setErro(errInsert?.message || "Falha ao criar configuração.");
        setSaving(false);
        return;
      }
      if (empresaIds.length > 0) {
        await supabase.from("config_email_empresas").insert(
          empresaIds.map((empresa_id) => ({ config_email_id: inserted.id, empresa_id }))
        );
      }
    }

    limparForm();
    await carregar();
    setSaving(false);
  }

  async function excluir(id: string) {
    if (!confirm("Excluir esta configuração de e-mail?")) return;
    await supabase.from("config_email").delete().eq("id", id);
    await carregar();
  }

  function toggleEmpresa(id: string) {
    setEmpresaIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  async function enviarTeste(e: React.FormEvent) {
    e.preventDefault();
    if (!testeConfigId.trim() || !testeTo.trim() || !testeAssunto.trim()) {
      setTesteErro("Preencha a configuração, o e-mail de destino e o assunto.");
      return;
    }
    setTesteEnviando(true);
    setTesteErro(null);
    setTesteSucesso(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setTesteErro("Sessão expirada. Faça login novamente.");
      setTesteEnviando(false);
      return;
    }
    const res = await fetch("/api/email/enviar-teste", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        config_email_id: testeConfigId.trim(),
        to_email: testeTo.trim(),
        subject: testeAssunto.trim(),
        descricao: testeDescricao.trim() || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTesteErro(j.error || res.statusText);
    } else {
      setTesteSucesso(j.message || "E-mail de teste enviado.");
    }
    setTesteEnviando(false);
  }

  if (loading) return <p className="text-slate-600">Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Envio de e-mail (Microsoft)</h1>
      <p className="text-slate-600 mt-1">
        Configure contas Microsoft para disparo automático de e-mails. Selecione quais empresas utilizarão cada configuração.
      </p>

      {erro && (
        <p className="mt-4 text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{erro}</p>
      )}

      {/* Envio de teste — só exibido para quem tem permissão enviar_email_teste */}
      {hasPermissao("enviar_email_teste") && (
        <section className="mt-6 p-4 border rounded bg-slate-50 max-w-2xl">
          <h2 className="font-semibold text-slate-800 mb-3">Envio de teste</h2>
          <p className="text-slate-600 text-sm mb-4">
            Escolha uma configuração e envie um e-mail de teste para validar o sistema.
          </p>
          <form onSubmit={enviarTeste} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Configuração de e-mail</label>
              <select
                value={testeConfigId}
                onChange={(e) => setTesteConfigId(e.target.value)}
                className="w-full px-3 py-2 border rounded"
                required
              >
                <option value="">— Selecione —</option>
                {lista.filter((c) => c.client_secret_encrypted).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.sender_name} ({c.sender_mailbox})
                  </option>
                ))}
                {lista.length > 0 && lista.every((c) => !c.client_secret_encrypted) && (
                  <option value="" disabled>Nenhuma configuração com Client Secret</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">E-mail de destino</label>
              <input
                type="email"
                value={testeTo}
                onChange={(e) => setTesteTo(e.target.value)}
                placeholder="destino@exemplo.com"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assunto</label>
              <input
                type="text"
                value={testeAssunto}
                onChange={(e) => setTesteAssunto(e.target.value)}
                placeholder="Teste - Sistema Receba"
                className="w-full px-3 py-2 border rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Descrição / Corpo do e-mail</label>
              <textarea
                value={testeDescricao}
                onChange={(e) => setTesteDescricao(e.target.value)}
                rows={4}
                placeholder="Texto do e-mail de teste..."
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            {testeSucesso && (
              <p className="text-green-700 bg-green-50 px-3 py-2 rounded text-sm">{testeSucesso}</p>
            )}
            {testeErro && (
              <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{testeErro}</p>
            )}
            <button
              type="submit"
              disabled={testeEnviando || lista.filter((c) => c.client_secret_encrypted).length === 0}
              className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
            >
              {testeEnviando ? "Enviando..." : "Enviar e-mail de teste"}
            </button>
          </form>
        </section>
      )}

      <form onSubmit={salvar} className="mt-8 space-y-4 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tenant ID</label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="78938b26-24e8-4ec6-92cc-95dd8f5f170f"
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Client ID</label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="16c3a53b-4a74-4d7e-9aee-44f4f7482b51"
              className="w-full px-3 py-2 border rounded"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Client Secret</label>
          <input
            type={mostrarSecret ? "text" : "password"}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={editando?.client_secret_encrypted ? "Deixe vazio para manter o atual" : "Obrigatório em novas configurações"}
            className="w-full px-3 py-2 border rounded"
          />
          {editando?.client_secret_encrypted && (
            <label className="text-sm mt-1 flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={mostrarSecret} onChange={(e) => setMostrarSecret(e.target.checked)} />
              Mostrar campo
            </label>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail remetente (Sender Mailbox)</label>
            <input
              type="email"
              value={senderMailbox}
              onChange={(e) => setSenderMailbox(e.target.value)}
              placeholder="financeiro@alldax.com"
              className="w-full px-3 py-2 border rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome remetente (Sender Name)</label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Financeiro Alldax"
              className="w-full px-3 py-2 border rounded"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Empresas que utilizarão este e-mail</label>
          <div className="flex flex-wrap gap-3 border rounded p-3 bg-slate-50 max-h-40 overflow-y-auto">
            {empresas.length === 0 ? (
              <p className="text-slate-500 text-sm">Nenhuma empresa cadastrada.</p>
            ) : (
              empresas.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={empresaIds.includes(emp.id)}
                    onChange={() => toggleEmpresa(emp.id)}
                    className="rounded"
                  />
                  <span className="text-sm">{emp.nome_curto}</span>
                </label>
              ))
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="ativo"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="ativo" className="text-sm font-medium text-slate-700">Ativo</label>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Salvando..." : editando ? "Atualizar" : "Adicionar configuração"}
          </button>
          {editando && (
            <button type="button" onClick={limparForm} className="px-4 py-2 border rounded hover:bg-slate-100">
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-slate-800 mb-3">Configurações cadastradas</h2>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left p-2">Remetente</th>
                <th className="text-left p-2">E-mail</th>
                <th className="text-left p-2">Empresas</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2">{c.sender_name}</td>
                  <td className="p-2">{c.sender_mailbox}</td>
                  <td className="p-2">
                    {c.config_email_empresas?.length
                      ? c.config_email_empresas
                          .map(
                            (ce) => empresas.find((e) => e.id === ce.empresa_id)?.nome_curto || ce.empresa_id
                          )
                          .join(", ")
                      : "—"}
                  </td>
                  <td className="p-2">
                    <span className={c.ativo ? "text-green-700" : "text-slate-500"}>
                      {c.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="p-2 flex gap-2">
                    <button type="button" onClick={() => iniciarEdicao(c)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button type="button" onClick={() => excluir(c.id)} className="text-red-600 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lista.length === 0 && (
          <p className="text-slate-500 py-4">Nenhuma configuração de e-mail cadastrada.</p>
        )}
      </div>
    </div>
  );
}
