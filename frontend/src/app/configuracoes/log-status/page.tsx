"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LogStatusRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/historico-status");
  }, [router]);
  return (
    <div className="p-4 text-slate-600">
      Redirecionando para Histórico de status...
    </div>
  );
}
