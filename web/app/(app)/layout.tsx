import { redirect } from "next/navigation";
import { Nav } from "../../components/nav";
import { dashboardGate } from "../../lib/gate";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const gate = await dashboardGate();
  if (gate.kind === "login") redirect("/login");
  if (gate.kind === "localhost-only") {
    return (
      <main className="shell">
        <p className="error" role="alert">Без DASHBOARD_PASSWORD дашборд відкривається лише з localhost.</p>
      </main>
    );
  }

  return (
    <div className="shell">
      <Nav locked={gate.locked} />
      <main>{children}</main>
    </div>
  );
}
