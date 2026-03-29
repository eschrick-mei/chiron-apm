"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AlertsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/issues"); }, [router]);
  return (
    <div className="flex h-screen items-center justify-center text-chiron-text-muted">
      Redirecting to Active Issues...
    </div>
  );
}
