export default function LogsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-4">Raw Lifecycle Logs</h1>
      <p className="text-gray-500 text-sm">
        All lifecycle events are persisted to{" "}
        <code className="bg-gray-800 px-1 rounded text-green-400">
          logs/dispatcher.db
        </code>
        . Query with{" "}
        <code className="bg-gray-800 px-1 rounded text-green-400">
          sqlite3 logs/dispatcher.db &quot;SELECT * FROM lifecycle_events ORDER BY timestamp DESC LIMIT 50;&quot;
        </code>
      </p>
    </div>
  );
}
