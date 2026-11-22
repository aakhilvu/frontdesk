import { AgentGate } from "@/components/client";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AgentGate>{children}</AgentGate>;
}
