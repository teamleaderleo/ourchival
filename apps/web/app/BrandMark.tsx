import Image from "next/image";

export function BrandMark() {
  return (
    <span className="brand-mark archive-mascot" aria-hidden="true">
      <Image src="/archive-cat.png" alt="" width={56} height={56} priority />
    </span>
  );
}
