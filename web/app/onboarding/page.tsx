"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Onboarding() {
  const router = useRouter();
  useEffect(() => router.replace("/interviews"), [router]);
  return (
    <p className="p-10" role="status">
      Explore interviews for any role…
    </p>
  );
}
