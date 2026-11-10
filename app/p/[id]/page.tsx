import { Suspense } from "react";
import SharedPlace from "@/components/SharedPlace";

// The place id is only known when the link is opened, so it waits inside
// Suspense (needed with Cache Components).
export default function SharedPlacePage() {
  return (
    <Suspense>
      <SharedPlace />
    </Suspense>
  );
}
