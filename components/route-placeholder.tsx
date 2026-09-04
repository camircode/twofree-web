type RoutePlaceholderProps = Readonly<{
  description: string;
  title: string;
  update: string;
}>;

export function RoutePlaceholder({ description, title, update }: RoutePlaceholderProps) {
  return (
    <section className="web-route-page" data-route-page>
      <h1>{title}</h1>
      <p className="web-route-page__description">{description}</p>
      <div className="web-route-page__state" data-route-state="placeholder" role="status">
        <p className="web-route-page__state-label">Próximamente</p>
        <p>{update}</p>
      </div>
    </section>
  );
}
