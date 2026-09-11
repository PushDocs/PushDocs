"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { documentHref, readProjectBranch } from "./project-context";

export function ProjectResumeLink({
  projectId,
  defaultBranch,
  children,
  className,
}: {
  projectId: string;
  defaultBranch: string;
  children: ReactNode;
  className?: string;
}) {
  const [href, setHref] = useState(
    `/projects/${projectId}/documents?${new URLSearchParams({ branch: defaultBranch })}`,
  );
  useEffect(() => {
    const update = () =>
      setHref(documentHref(projectId, readProjectBranch(projectId, defaultBranch)));
    update();
    window.addEventListener("pushdocs:context", update);
    return () => window.removeEventListener("pushdocs:context", update);
  }, [projectId, defaultBranch]);
  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}
