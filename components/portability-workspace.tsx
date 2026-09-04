"use client";

import { PortabilityExperience } from "@camircode/twofree-ui/portfolio";
import {
  ApiProvider,
  type PortableProductEnvelope,
} from "@camircode/twofree-data-provider/browser";

import { browserApiBaseUrl } from "@/lib/runtime-api";

const api = new ApiProvider(browserApiBaseUrl());

export function PortabilityWorkspace({ guestMode = false }: Readonly<{ guestMode?: boolean }>) {
  async function exportData(): Promise<string> {
    const envelope = guestMode
      ? {
          format: "2free-portable" as const,
          version: 2 as const,
          exportedAt: new Date().toISOString(),
          records: [],
        }
      : await api.exportProducts();
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `2free-productos-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return guestMode
      ? "La copia de demostración se descargó sin incluir datos personales."
      : "La copia portable se descargó desde la API autenticada.";
  }

  async function importData(file: File): Promise<string> {
    if (file.size > 5_000_000) throw new Error("El archivo supera el límite de 5 MB.");
    let parsed: PortableProductEnvelope;
    try {
      parsed = JSON.parse(await file.text()) as PortableProductEnvelope;
    } catch {
      throw new Error("El archivo no contiene JSON válido.");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.format !== "2free-portable" ||
      parsed.version !== 2
    ) {
      throw new Error("El archivo no tiene un formato 2 Free compatible.");
    }
    if (!guestMode) await api.importProducts(parsed);
    return guestMode
      ? "El respaldo es compatible. La demo no conserva importaciones."
      : "La API validó e importó el respaldo portable.";
  }

  return <PortabilityExperience onExport={exportData} onImport={importData} />;
}
