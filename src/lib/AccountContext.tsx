import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AccountError, api, jsonOptions } from "./cloud";
import type { AccountUser } from "./cloud";

type Account = {
  user: AccountUser | null;
  available: boolean;
  loading: boolean;
  unavailableReason: string;
  signIn(username: string, password: string, register: boolean): Promise<void>;
  signOut(): Promise<void>;
};
const Context = createContext<Account | null>(null);
export const useAccount = () => useContext(Context)!;
export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState(
    "Accounts are not connected on this site yet. You can still use your device library.",
  );
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    api<{ available: boolean; user: AccountUser | null }>("/auth/session", {
      signal: controller.signal,
    })
      .then((data) => {
        if (alive) {
          setAvailable(data.available);
          setUser(data.user);
        }
      })
      .catch(() => {
        if (alive) {
          setAvailable(false);
          setUnavailableReason(
            "The account service could not be reached. Refresh to try again. Your device library is still available.",
          );
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  async function signIn(username: string, password: string, register: boolean) {
    const result = await api<{ user: AccountUser }>(
      `/auth/${register ? "register" : "login"}`,
      jsonOptions("POST", { username, password }),
    );
    setUser(result.user);
  }
  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof AccountError && error.status === 401)) throw error;
    }
    setUser(null);
  }
  return (
    <Context.Provider
      value={{ user, available, loading, unavailableReason, signIn, signOut }}
    >
      {children}
    </Context.Provider>
  );
}
