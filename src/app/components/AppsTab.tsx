type AppsTabProps = {
  viewApiBaseUrl: string;
};

export function AppsTab(_props: AppsTabProps) {
  return (
    <section className="builder-shell">
      <div className="builder-result-card">
        <h3 className="builder-result-title">Apps Disabled</h3>
        <p className="builder-result-empty">
          Guided app flows are intentionally out of the active path. The current contract is Codama + runtime only.
        </p>
      </div>
    </section>
  );
}
