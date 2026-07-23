# Creative exploration

Use this optional workflow when a consequential visual, interaction, or product-language decision has several credible answers and the preferred direction is unclear.

The sequence is:

1. **Diverge:** produce a few intentionally different candidates against the same brief and vault state.
2. **Converge:** make a human decision, choose one direction, and continue iterating there.

Parallel candidates help discover a direction. A continuing implementation thread is usually better once the direction is known.

## Direction or execution?

- **Direction uncertainty:** several substantially different answers could satisfy the requirements. Explore alternatives.
- **Execution uncertainty:** the desired result is clear and the current attempt needs refinement. Stay on one branch and iterate.

Choosing the vault’s main browsing model, capture-session review, inspector hierarchy, or authentication language may justify alternatives. Repairing authorization, media processing, queue behavior, accessibility, and an accepted visual direction belongs in one verified implementation.

## Use selectively

Parallel exploration is useful when:

- the decision affects repeated archive or review work;
- several valid treatments are plausible;
- seeing alternatives could change the decision;
- candidates are inexpensive enough to discard;
- human taste and collection habits carry substantial value.

A single implementation is usually sufficient when security, privacy, data integrity, or an accepted direction determines most of the answer.

## Prepare the brief

Separate fixed requirements from open decisions.

### Fixed

Every candidate should preserve:

- owner-only access and explicit authorization;
- Clipper device pairing and revocation;
- source references, stored originals, derivatives, and provenance;
- capture-session and enrichment identities;
- private media URLs and storage behavior;
- retry, queue, and failure semantics;
- accessibility and responsive behavior;
- established collection and tag behavior.

### Open

Name the questions the exploration should answer:

- What should dominate the vault home view?
- How should a capture session differ from individual-reference review?
- Which metadata belongs beside the image?
- How should enrichment progress and failures appear?
- How should duplicate and similarity review feel?
- Which controls should remain visible in the inspector?
- How should sign-in, pairing, recovery, and revocation be explained?

## References and anti-references

Use a small set of relevant visual archives, research boards, media libraries, collection tools, current Ourchival screens, and prior experiments. Record the specific quality worth examining.

Also record patterns to avoid: generic asset-management dashboards, overwhelming metadata grids, image galleries with weak source context, hidden privacy consequences, ambiguous deletion, decorative masonry that disrupts review, or authentication copy that obscures the actual access model.

References provide vocabulary. Candidates still need to serve Ourchival’s private collection and review flow.

## Choose the amount of divergence

- **Small variation:** compare metadata grouping, controls, copy, density, or mobile disclosure.
- **Directional variation:** compare gallery-first, review-first, provenance-first, or compact expert presentations.
- **Conceptual variation:** compare different vault, session, or inspector models.

Use the cheapest level that supports a real decision.

## Assign distinct candidates

Three candidates are a useful default. Possible assignments:

- **Gallery-first:** prioritize visual browsing and lightweight collection movement.
- **Review-first:** prioritize inbox, sessions, decisions, and clear completion states.
- **Provenance-first:** keep source, capture, derivative, enrichment, and access information continuously understandable.

A continuity or reduction candidate can replace one of these when the existing interface already provides a strong baseline.

Candidates should work independently during their first pass and receive the same seeded vault, reference set, session data, viewport sizes, and fixed requirements.

## Require comparable evidence

Every candidate should use:

- the same seeded references and media;
- the same tags, boards, projects, and searches;
- the same capture sessions and enrichment jobs;
- matching viewport sizes;
- the same build, typecheck, and browser expectations;
- a branch and exact commit;
- matching screenshots or recordings;
- a short statement of decisions and compromises.

Useful checkpoints include:

- locked or signed-out vault;
- normal gallery browsing;
- selected-reference inspector;
- multi-item capture session;
- saved, skipped, and failed capture results;
- enrichment queue and terminal failure;
- near-duplicate review;
- Drive or storage-backed media;
- device pairing and revocation;
- narrow/mobile layout.

## Review by decision

Compare individual decisions:

- Which version makes saved material easiest to rediscover?
- Which keeps the image central while preserving source context?
- Which distinguishes capture, review, enrichment, and organization clearly?
- Which handles a dense archive calmly?
- Which mobile behavior remains useful?
- Which interaction would become irritating during repeated review?
- Which feels specific to Ourchival rather than a generic media library?
- Which privacy or access language could be misunderstood?
- Which ideas remain useful as the archive grows?

Agent review can check the brief, omitted states, accessibility, security-language consistency, and preservation of data rules. Human review owns visual taste and collection behavior.

## Converge explicitly

Record accepted and rejected decisions directly:

> Use A’s gallery density, B’s session drawer, and C’s source panel. Preserve the current per-reference inbox behavior. Reject the persistent activity sidebar and ambiguous bulk-complete action.

Choose one canonical branch. Give the convergence pass the original brief, accepted elements, rejected directions and reasons, unresolved details, and verification requirements.

Return to one implementation when the preferred direction can be described clearly, new candidates mostly rearrange details, or remaining concerns can be written as specific edits.

## Fidelity ladder

Choose the lowest-cost artifact that supports the decision:

1. written direction;
2. rough flow or layout;
3. static HTML or screenshot;
4. isolated gallery, session, or inspector component;
5. working branch;
6. complete interactive prototype.

Use working code when selection, keyboard behavior, media loading, queue updates, device access, responsiveness, or transitions determine quality.

## Lightweight record

```md
# Creative exploration

## Decision to make

## Fixed requirements
- 

## Open questions
- 

## References and anti-references
- 

## Candidates
- A: gallery-first
- B: review-first
- C: provenance-first

## Shared vault state and required evidence
- 

## Selection
- Keep:
- Combine:
- Reject:
- Explore during convergence:

## Canonical branch and commit

## Remaining questions
- 
```

## Possible uses in Ourchival

This workflow may be useful for vault browsing, capture-session review, reference inspection, enrichment queues, duplicate review, tags and boards, saved searches, authentication, device pairing, onboarding, and public or extension copy.

Keep authorization, revocation, source identity, derivative provenance, private storage, queue behavior, and destructive-action rules fixed across candidates. Explore how clearly and pleasantly the owner moves through those capabilities.