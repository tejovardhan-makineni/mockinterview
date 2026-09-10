"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Dashboard() {
  const router = useRouter();
  useEffect(() => router.replace("/interviews"), [router]);
  return (
    <p className="p-10" role="status">
      Opening practice…
    </p>
  );
}
