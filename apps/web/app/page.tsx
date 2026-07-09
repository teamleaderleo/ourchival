import { ReferenceVault } from "./ReferenceVault";

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

      <ReferenceVault />
    </main>
  );
}
