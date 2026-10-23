import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { AccountProvider, useAccount } from "./lib/AccountContext";

function AccountApp() {
  const { user, loading } = useAccount();
  if (loading)
    return (
      <div className="account-loading" role="status">
        Opening your listening space…
      </div>
    );
  // A new tree clears playback, cover URLs, and library state when accounts change.
  return <App key={user?.id ?? "device"} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AccountProvider>
      <AccountApp />
    </AccountProvider>
  </React.StrictMode>,
);
