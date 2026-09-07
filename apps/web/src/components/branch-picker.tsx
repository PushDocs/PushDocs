"use client";

import { Select } from "@pushdocs/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function BranchPicker({
  branches,
  value,
}: {
  branches: Array<{ full_ref: string }>;
  value: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <Select
      label="Ветка"
      value={value}
      options={branches.map((branch) => ({ label: branch.full_ref, value: branch.full_ref }))}
      onValueChange={(branch) => {
        const query = new URLSearchParams(searchParams);
        query.set("branch", branch);
        query.delete("path");
        router.push(`${pathname}?${query.toString()}`);
      }}
    />
  );
}
