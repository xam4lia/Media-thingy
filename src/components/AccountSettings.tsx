import { useState } from "react";
import {
  Cloud,
  ExternalLink,
  LoaderCircle,
  LogOut,
  UserRound,
} from "lucide-react";
import { useAccount } from "../lib/AccountContext";
import { copyDeviceSongs } from "../lib/cloud";

export function AccountSettings({
  beforeLeave,
  onImported,
  busy,
}: {
  beforeLeave(): Promise<void>;
  onImported(): Promise<void>;
  busy: boolean;
}) {
  const account = useAccount();
  const setupUrl = `${import.meta.env.BASE_URL}setup.html`;
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setError("");
    setMessage("");
    setPending(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="settings-section account-settings"
      aria-labelledby="account-heading"
    >
      <div className="settings-section-heading">
        <div>
          <h3 id="account-heading">
            <UserRound size={18} /> Your account
          </h3>
          <p>
            {account.user
              ? `Signed in as ${account.user.username}`
              : "Your music, wherever you sign in."}
          </p>
        </div>
      </div>
      {account.loading ? (
        <p role="status">Checking your account…</p>
      ) : !account.available ? (
        <>
          <p className="account-notice">{account.unavailableReason}</p>
          <a className="button button-dark" href={setupUrl}>
            Set up free accounts <ExternalLink size={16} />
          </a>
          <p className="settings-hint">
            This opens the setup page already included with your website.
          </p>
        </>
      ) : account.user ? (
        <>
          <p className="account-notice">
            <Cloud size={17} /> Songs you add now save privately to your
            account. Up to 50 MB per song.
          </p>
          <button
            type="button"
            className="button button-light"
            disabled={pending || busy}
            onClick={() =>
              void run(async () => {
                await beforeLeave();
                const result = await copyDeviceSongs(setMessage);
                await onImported();
                setMessage(
                  `${result.copied} ${result.copied === 1 ? "song copied" : "songs copied"}. Your device library is still here.`,
                );
                if (result.errors.length)
                  setError(result.errors.slice(0, 3).join(" "));
              })
            }
          >
            <Cloud size={16} /> Copy this device’s songs to account
          </button>
          <p className="settings-hint">
            Copies songs, lyrics, favorites, and song covers from this browser.
            You can retry safely.
          </p>
          <button
            type="button"
            className="button button-light"
            disabled={pending || busy}
            onClick={() =>
              void run(async () => {
                await beforeLeave();
                await account.signOut();
              })
            }
          >
            <LogOut size={16} /> Sign out
          </button>
        </>
      ) : (
        <>
          <div
            className="account-tabs"
            role="group"
            aria-label="Account action"
          >
            <button
              type="button"
              aria-pressed={!register}
              disabled={pending}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={register}
              disabled={pending}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              Create account
            </button>
          </div>
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (register && password !== confirmation)
                  throw new Error("Your passwords do not match.");
                await account.signIn(username, password, register);
                setPassword("");
                setConfirmation("");
              });
            }}
          >
            <label>
              Username
              <input
                name="username"
                required
                autoComplete="username"
                pattern="[A-Za-z0-9_]{3,32}"
                minLength={3}
                maxLength={32}
                value={username}
                disabled={pending}
                onChange={(event) => setUsername(event.target.value)}
                spellCheck={false}
                autoCapitalize="none"
              />
            </label>
            <span className="settings-hint">
              3–32 letters, numbers, or underscores.
            </span>
            <label>
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete={register ? "new-password" : "current-password"}
                minLength={12}
                maxLength={128}
                value={password}
                disabled={pending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {register && (
              <>
                <span className="settings-hint">
                  At least 12 characters. Keep your password safe; there is no
                  email reset.
                </span>
                <label>
                  Confirm password
                  <input
                    name="confirmation"
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    disabled={pending}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            )}
            <button
              className="button button-dark"
              disabled={pending || busy}
              type="submit"
            >
              {pending && <LoaderCircle size={16} className="spin" />}
              {register ? "Create my account" : "Sign in to my account"}
            </button>
          </form>
          <p className="settings-hint">
            No email or Google account needed. After signing in, you can copy
            this device’s songs into your account.
          </p>
        </>
      )}
      {pending && message && (
        <p className="account-feedback" role="status">
          <LoaderCircle size={15} className="spin" /> {message}
        </p>
      )}
      {!pending && message && (
        <p className="account-feedback" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="account-feedback account-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
