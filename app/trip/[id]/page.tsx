import { Suspense } from "react";
import TripPage from "@/components/TripPage";

// The trip is only known when opened, so it waits inside Suspense.
export default function Page() {
  return (
    <Suspense>
      <TripPage />
    </Suspense>
  );
}
