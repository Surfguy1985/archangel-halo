export function BrandLogoPage() {
  const logoUrl = `${import.meta.env.BASE_URL}logo.png`;

  return (
    <div className="space-y-10">
      <section className="rounded-xl border bg-card p-8 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-6">
          Primary mark — light background
        </h2>
        <div className="flex items-center justify-center rounded-lg bg-background border p-12">
          <img
            src={logoUrl}
            alt="HALO logo"
            className="h-14 w-auto object-contain"
          />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-8 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-6">
          Primary mark — dark background
        </h2>
        <div className="flex items-center justify-center rounded-lg p-12" style={{ background: '#07101E' }}>
          <img
            src={logoUrl}
            alt="HALO logo on dark"
            className="h-14 w-auto object-contain"
          />
        </div>
      </section>

      <section className="rounded-xl border bg-card p-8 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-4">
          Clear space &amp; sizing
        </h2>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p>Maintain at least <strong className="text-foreground">1× the logo height</strong> of clear space on all sides.</p>
          <p>Minimum display size: <strong className="text-foreground">28px tall</strong> (digital). Never scale below this — use the wordmark on its own at small sizes.</p>
          <p>Never recolour, stretch, rotate, or add drop shadows to the mark.</p>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-8 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-6">
          Brand colours
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { name: 'Lime', hex: '#B4FF44', text: 'text-black' },
            { name: 'Deep Navy', hex: '#041029', text: 'text-white' },
            { name: 'Navy', hex: '#07101E', text: 'text-white' },
            { name: 'Mid Navy', hex: '#13223A', text: 'text-white' },
          ].map(({ name, hex, text }) => (
            <div key={name} className="space-y-2">
              <div
                className={`flex h-20 items-end rounded-lg p-3 ${text}`}
                style={{ background: hex }}
              >
                <span className="text-xs font-mono font-semibold">{hex}</span>
              </div>
              <p className="text-sm font-medium">{name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
