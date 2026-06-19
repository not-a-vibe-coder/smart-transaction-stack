import PaymentQueue from "@/components/PaymentQueue";
import AgentPanel from "@/components/AgentPanel";
import SlotMonitor from "@/components/SlotMonitor";
import NotificationFeed from "@/components/NotificationFeed";

export default function DashboardPage() {
  return (
    <div className="relative">
      <h1 className="text-xl font-semibold text-white mb-6">Live Dashboard</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1">
          <PaymentQueue />
        </div>
        <div className="lg:col-span-1">
          <AgentPanel />
        </div>
        <div className="lg:col-span-1">
          <SlotMonitor />
        </div>
      </div>
      <NotificationFeed />
    </div>
  );
}
