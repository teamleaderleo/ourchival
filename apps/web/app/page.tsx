const sampleReferences = [
  {
    title: "First saved reference",
    source: "https://example.com/source",
    tags: ["study", "lighting", "composition"],
  },
  {
    title: "Character silhouette study",
    source: "Manual upload",
    tags: ["character", "form", "gesture"],
  },
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Ourchival</p>
        <h1>Reliquary</h1>
        <p className="lede">
          A private vault for art references, source metadata, boards, notes, and
          the images that stay with you.
        </p>
      </section>

      <section className="toolbar">
        <button>Upload reference</button>
        <button>New board</button>
        <button>Install clipper</button>
      </section>

      <section className="grid">
        {sampleReferences.map((reference) => (
          <article className="card" key={reference.title}>
            <div className="thumb" />
            <h2>{reference.title}</h2>
            <p>{reference.source}</p>
            <div className="tags">
              {reference.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
