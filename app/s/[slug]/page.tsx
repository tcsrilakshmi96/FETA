import { Suspense } from "react";
import GroupShare from "@/components/GroupShare";

// The link is only known when opened, so it waits inside Suspense.
export default function GroupSharePage() {
  return (
    <Suspense>
      <GroupShare />
    </Suspense>
  );
}
