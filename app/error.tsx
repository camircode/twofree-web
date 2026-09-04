"use client";

import { useEffect } from "react";

import { basePath } from "@/lib/base-path";

type ErrorBoundaryProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="web-route-page" data-route-page>
      <p className="web-route-page__eyebrow">Espacio financiero</p>
      <h1>No se pudo mostrar esta página</h1>
      <p className="web-route-page__description" role="alert">
        Ocurrió un error inesperado. No se muestran detalles internos.
      </p>
      <div className="web-route-page__actions">
        <button className="web-route-page__button" onClick={() => reset()} type="button">
          Intentar de nuevo
        </button>
        <a className="web-route-page__link" href={`${basePath}/`}>
          Volver al inicio
        </a>
      </div>
    </section>
  );
}
