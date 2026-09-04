export default function Loading() {
  return (
    <section aria-busy="true" className="web-route-page" data-route-page>
      <p className="web-route-page__eyebrow">Espacio financiero</p>
      <h1>Cargando el espacio financiero</h1>
      <p className="web-route-page__description" role="status">
        Cargando…
      </p>
    </section>
  );
}
