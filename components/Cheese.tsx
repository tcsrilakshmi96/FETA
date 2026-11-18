import Mascot from "@/components/Mascot";

// Feta's cheese at icon size (the Ask tab and Ask Feta's header): the face
// only, blinking and bobbing.
export default function Cheese({ width = 36 }: { width?: number }) {
  return <Mascot size={width} limbs={false} />;
}
